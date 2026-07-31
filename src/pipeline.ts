import { constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DemoConfig, Shot, TtsResult } from "./types";
import { parseScript, deriveSegmentKinds } from "./parse-script";
import { formatPreflightReport, runPreflight } from "./preflight";
import { synthShot } from "./tts";
import { captureShot } from "./capture";
import { resolveClipPath } from "./clips";
import { titleCardArgs, endCardArgs } from "./cards";
import { ffmpeg, run as runProcess, silentMp3Args } from "./ffmpeg";
import { renderVideo, type RenderResult } from "./render";
import { renderRemote } from "./remote-render";
import type { Transport } from "./transport";
import {
  buildRenderReport,
  digest,
  digestFile,
  digestFull,
  persistRenderReport,
  stableConfigJson,
  toolVersions,
  type ClipInputDigest,
  type PreflightRecord,
} from "./provenance";
import { resolveTtsMode } from "./tts";
import { captureViewport } from "./platforms";
import {
  assertSourceBuildExecutionContext,
  assertSourceBuildUnchanged,
  type SourceBuildSession,
} from "./source-build";

interface RunPipelineOpts {
  /** Offload the render stage to a remote host over the given transport. Absent = local render (default). */
  render?: { transport: Transport; bundlePath?: string; workDir?: string };
  /** Refuse an existing output path before reading inputs or mutating artifacts. */
  requireFreshOut?: boolean;
  /** Source-run admission created by the CLI before any output claim. */
  sourceBuild?: SourceBuildSession;
}

interface FreshOutputClaim {
  requestedPath: string;
  claimPath: string;
  stagingPath: string;
  boundPath: string;
  parentHandle: FileHandle;
  claimHandle: FileHandle;
  stagingHandle: FileHandle;
  claimDev: number;
  claimIno: number;
  stagingDev: number;
  stagingIno: number;
  publishAttempted: boolean;
  published: boolean;
}

type ResolvedClipInputDigest = ClipInputDigest & { path: string };

async function digestPrebakedInputs(
  shots: Shot[],
  config: DemoConfig,
): Promise<ResolvedClipInputDigest[]> {
  const inputs: ResolvedClipInputDigest[] = [];
  for (const shot of shots) {
    if (shot.target !== "prebaked") continue;
    if (!shot.clip) {
      throw new Error(`[agent-demo-video] prebaked shot ${shot.id} has no clip path to hash`);
    }
    const path = resolveClipPath(
      shot.clip,
      config.clipsDir,
      config.configDir ?? process.cwd(),
    );
    try {
      inputs.push({ shotId: shot.id, path, sha256: await digestFile(path) });
    } catch (error) {
      throw new Error(
        `[agent-demo-video] could not hash prebaked input for shot "${shot.id}" at ${path}: ` +
        `${(error as Error).message}`,
      );
    }
  }
  return inputs;
}

async function assertPrebakedInputsUnchanged(
  inputs: ResolvedClipInputDigest[],
): Promise<void> {
  for (const input of inputs) {
    let current: string;
    try {
      current = await digestFile(input.path);
    } catch (error) {
      throw new Error(
        `[agent-demo-video] could not re-check prebaked input for shot "${input.shotId}" at ${input.path}: ` +
        `${(error as Error).message}`,
      );
    }
    if (current !== input.sha256) {
      throw new Error(
        `[agent-demo-video] prebaked input changed during capture for shot "${input.shotId}": ${input.path}. ` +
        "No render was started; use an immutable attempt-owned clip copy and retry.",
      );
    }
  }
}

/**
 * Atomically reserve the requested output name with an exclusive regular file,
 * then render through an open handle to a private sibling staging directory.
 *
 * Publishing a directory before opening it leaves a mkdir-to-open race: a
 * competing process can replace that directory with reviewed artifacts and
 * make the replacement look like the one we just created. An O_EXCL file claim
 * has no such public reopen window. The requested name remains occupied for the
 * entire render, while every artifact write goes through the staging directory
 * handle exposed under /proc.
 */
async function claimFreshOutputDir(requestedPath: string): Promise<FreshOutputClaim> {
  if (process.platform !== "linux") {
    throw new Error(
      "[agent-demo-video] immutable --out claims require Linux /proc directory handles; " +
      "run the production attempt on a Linux filesystem under Linux or WSL",
    );
  }
  const requestedParent = dirname(requestedPath);
  const requestedName = basename(requestedPath);
  if (!requestedName || requestedName === "." || requestedName === "..") {
    throw new Error(`[agent-demo-video] --out must name a new child directory: ${requestedPath}`);
  }
  await mkdir(requestedParent, { recursive: true });

  let parentHandle: FileHandle | undefined;
  let claimHandle: FileHandle | undefined;
  let stagingHandle: FileHandle | undefined;
  let claimPath: string | undefined;
  let stagingPath: string | undefined;
  let claimDev: number | undefined;
  let claimIno: number | undefined;
  let stagingDev: number | undefined;
  let stagingIno: number | undefined;
  try {
    parentHandle = await open(
      requestedParent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const boundParent = `/proc/${process.pid}/fd/${parentHandle.fd}`;
    claimPath = join(boundParent, requestedName);
    try {
      claimHandle = await open(
        claimPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`[agent-demo-video] fresh output path already exists: ${requestedPath}`);
      }
      throw error;
    }
    const claimed = await claimHandle.stat();
    claimDev = claimed.dev;
    claimIno = claimed.ino;
    const publicClaim = await lstat(requestedPath).catch(() => undefined);
    if (
      !publicClaim?.isFile() ||
      publicClaim.isSymbolicLink() ||
      publicClaim.dev !== claimDev ||
      publicClaim.ino !== claimIno
    ) {
      throw new Error(
        `[agent-demo-video] fresh output pathname changed after claim: ${requestedPath}. ` +
        `Writes stayed in the private staging directory; the replacement target was not touched.`,
      );
    }

    // mkdtemp gives the private stage an unpredictable name and mode 0700.
    // Authenticate its creation window and emptiness before the first write
    // so an accidentally reused or pre-existing stage is rejected. This is
    // not an isolation boundary against a malicious process with the same uid.
    const stagingCreateStartedMs = Date.now();
    stagingPath = await mkdtemp(join(boundParent, `.${requestedName}.stage-`));
    const namedStage = await lstat(stagingPath);
    stagingHandle = await open(
      stagingPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const openedStage = await stagingHandle.stat();
    stagingDev = openedStage.dev;
    stagingIno = openedStage.ino;
    if (
      !namedStage.isDirectory() ||
      namedStage.isSymbolicLink() ||
      namedStage.dev !== stagingDev ||
      namedStage.ino !== stagingIno
    ) {
      throw new Error(
        `[agent-demo-video] fresh output staging directory changed while it was being bound: ${stagingPath}`,
      );
    }
    const boundPath = `/proc/${process.pid}/fd/${stagingHandle.fd}`;
    const bound = await lstat(boundPath);
    if (!bound.isSymbolicLink()) {
      throw new Error(`[agent-demo-video] could not bind fresh output through ${boundPath}`);
    }
    const stageMode = Number(openedStage.mode & 0o777);
    const birthtimeSlopMs = 1_000; // accommodates filesystems with 1s timestamp granularity
    if (
      openedStage.birthtimeMs < stagingCreateStartedMs - birthtimeSlopMs ||
      openedStage.birthtimeMs > Date.now() + birthtimeSlopMs ||
      stageMode !== 0o700 ||
      (typeof process.geteuid === "function" && openedStage.uid !== process.geteuid()) ||
      (await readdir(boundPath)).length !== 0
    ) {
      throw new Error(
        `[agent-demo-video] fresh output staging directory was not the new private empty directory: ${stagingPath}. ` +
        "Use a Linux filesystem (not a mounted Windows/DrvFs path).",
      );
    }
    return {
      requestedPath,
      claimPath,
      stagingPath,
      boundPath,
      parentHandle,
      claimHandle,
      stagingHandle,
      claimDev,
      claimIno,
      stagingDev,
      stagingIno,
      publishAttempted: false,
      published: false,
    };
  } catch (error) {
    // Never clean these mutable pathnames here. A cooperating caller can
    // quarantine an abandoned claim/stage after inspecting it, but a
    // lstat-then-rm/unlink sequence could delete an object installed between
    // the identity check and the destructive call.
    await stagingHandle?.close().catch(() => {});
    await claimHandle?.close().catch(() => {});
    await parentHandle?.close().catch(() => {});
    throw error;
  }
}

async function assertClaimPathUnchanged(claim: FreshOutputClaim): Promise<void> {
  try {
    const named = await lstat(claim.requestedPath);
    if (
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.dev !== claim.claimDev ||
      named.ino !== claim.claimIno
    ) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error(
      `[agent-demo-video] fresh output pathname changed after claim: ${claim.requestedPath}. ` +
      `Writes stayed in the private staging directory; the replacement target was not touched.`,
    );
  }
}

async function assertStagingPathUnchanged(claim: FreshOutputClaim): Promise<void> {
  const named = await lstat(claim.stagingPath).catch(() => undefined);
  if (
    !named?.isDirectory() ||
    named.isSymbolicLink() ||
    named.dev !== claim.stagingDev ||
    named.ino !== claim.stagingIno
  ) {
    throw new Error(
      `[agent-demo-video] fresh output staging pathname changed: ${claim.stagingPath}`,
    );
  }
}

/**
 * Replace the exclusive claim file with the completed (or diagnostic partial)
 * staging directory. The two names are siblings, so GNU mv's long-supported
 * no-clobber mode is necessarily a same-filesystem, no-replace rename. Because
 * mv reports success for one no-clobber collision mode, inode/name checks
 * remain the authority.
 */
async function publishFreshOutput(claim: FreshOutputClaim): Promise<void> {
  if (claim.published) return;
  if (claim.publishAttempted) {
    throw new Error(
      `[agent-demo-video] fresh output publication was already attempted: ${claim.requestedPath}`,
    );
  }
  claim.publishAttempted = true;
  await assertClaimPathUnchanged(claim);
  await assertStagingPathUnchanged(claim);

  // Vacate the public name without unlinking through a mutable pathname. Park
  // the claim under an unpredictable sibling name, authenticate the moved
  // inode against the still-open handle, then retain it as a marker inside the
  // handle-bound stage. Every move is no-clobber, so a cooperative collision
  // leaves both objects available for inspection instead of deleting either.
  //
  // This is not hostile same-UID isolation: a process with the same uid can
  // mutate our paths and /proc handles. The contract here is non-destructive
  // behavior for accidental/cooperative collisions.
  const parkedClaimPath = join(
    dirname(claim.claimPath),
    `.${basename(claim.claimPath)}.claim-${randomUUID()}`,
  );
  await runProcess("mv", [
    "-T",
    "--no-clobber",
    "--",
    claim.claimPath,
    parkedClaimPath,
  ]);
  const claimStillNamed = await lstat(claim.claimPath).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  const parkedClaim = await lstat(parkedClaimPath).catch(() => undefined);
  if (
    claimStillNamed ||
    !parkedClaim?.isFile() ||
    parkedClaim.isSymbolicLink() ||
    parkedClaim.dev !== claim.claimDev ||
    parkedClaim.ino !== claim.claimIno
  ) {
    // Best-effort no-clobber restoration only; never remove either pathname.
    if (!claimStillNamed && parkedClaim) {
      await runProcess("mv", [
        "-T",
        "--no-clobber",
        "--",
        parkedClaimPath,
        claim.claimPath,
      ]).catch(() => {});
    }
    throw new Error(
      `[agent-demo-video] fresh output claim identity changed while publication began: ${claim.requestedPath}`,
    );
  }

  const claimMarkerPath = join(claim.boundPath, ".agent-demo-video-output-claim");
  if (await lstat(claimMarkerPath).catch(() => undefined)) {
    throw new Error(
      `[agent-demo-video] fresh output claim marker already exists in staging: ${claim.stagingPath}`,
    );
  }
  await runProcess("mv", [
    "-T",
    "--no-clobber",
    "--",
    parkedClaimPath,
    claimMarkerPath,
  ]);
  const parkedStillNamed = await lstat(parkedClaimPath).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  const claimMarker = await lstat(claimMarkerPath).catch(() => undefined);
  if (
    parkedStillNamed ||
    !claimMarker?.isFile() ||
    claimMarker.isSymbolicLink() ||
    claimMarker.dev !== claim.claimDev ||
    claimMarker.ino !== claim.claimIno
  ) {
    throw new Error(
      `[agent-demo-video] fresh output claim could not be retained in staging: ${claim.stagingPath}`,
    );
  }

  try {
    await runProcess("mv", [
      "-T",
      "--no-clobber",
      "--",
      claim.stagingPath,
      claim.claimPath,
    ]);
  } catch (error) {
    const recoveryPath = await realpath(claim.boundPath).catch(() => claim.stagingPath);
    throw new Error(
      `[agent-demo-video] could not atomically publish fresh output at ${claim.requestedPath}; ` +
      `staged artifacts remain at ${recoveryPath}: ${(error as Error).message}`,
    );
  }

  const stageStillNamed = await lstat(claim.stagingPath).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (stageStillNamed) {
    throw new Error(
      `[agent-demo-video] fresh output publication collided at ${claim.requestedPath}; ` +
      `the replacement target was not touched and staged artifacts remain at ${claim.stagingPath}`,
    );
  }
  for (const path of [claim.claimPath, claim.requestedPath]) {
    const named = await lstat(path).catch(() => undefined);
    if (
      !named?.isDirectory() ||
      named.isSymbolicLink() ||
      named.dev !== claim.stagingDev ||
      named.ino !== claim.stagingIno
    ) {
      throw new Error(
        `[agent-demo-video] fresh output pathname changed during publication: ${claim.requestedPath}`,
      );
    }
  }
  claim.published = true;
}

/** Path to the built remote-render bundle, resolved relative to this module. */
function defaultBundlePath(): string {
  return fileURLToPath(new URL("../dist-remote/remote-entry.js", import.meta.url));
}

/**
 * Refuse to offload to a bundle older than the sources it was built from.
 *
 * `existsSync` alone is not a guard: `pnpm demo` runs tsx against source and
 * never rebuilds dist-remote, so a stale bundle silently runs an OLD renderer
 * on the host. That was observed enforcing the previous hardcoded 300s ceiling
 * while the operator had declared a shorter cap, and the render report then
 * recorded the declared cap beside a parity pass that never checked it. A
 * receipt certifying an unenforced limit is worse than no receipt.
 */
function assertBundleFresh(bundlePath: string): void {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  if (!existsSync(srcDir)) return; // installed package: built at prepack, nothing to compare
  const bundleMs = statSync(bundlePath).mtimeMs;
  const stale = readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ f, ms: statSync(join(srcDir, f)).mtimeMs }))
    .filter((s) => s.ms > bundleMs)
    .map((s) => s.f);
  if (stale.length > 0) {
    throw new Error(
      `[agent-demo-video] the remote render bundle at ${bundlePath} is older than ${stale.length} source file(s) ` +
        `(${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", ..." : ""}). ` +
        "A stale bundle runs an OLD renderer on the host and can silently ignore settings this run declares. " +
        "Run `pnpm build:remote-entry` and retry.",
    );
  }
}

export async function runPipeline(config: DemoConfig, opts: RunPipelineOpts = {}): Promise<RenderResult> {
  if (opts.sourceBuild) {
    if (opts.render) {
      throw new Error(
        "[agent-demo-video] source-attested pipeline runs cannot use remote rendering",
      );
    }
    await assertSourceBuildExecutionContext(
      opts.sourceBuild,
      fileURLToPath(import.meta.url),
    );
  }
  const receiptConfig = config;
  const requestedOut = resolve(config.out);
  const freshClaim = opts.requireFreshOut
    ? await claimFreshOutputDir(requestedOut)
    : undefined;
  const out = freshClaim?.boundPath ?? requestedOut;
  if (freshClaim) config = { ...config, out };

  try {
    if (!freshClaim) {
      // A receipt must never outlive the render attempt it describes.
      // Invalidate it before any fail-fast check, including preflight:
      // otherwise a rejected rehearsal can leave the previous run's passing
      // report beside stale media and make file presence look like proof of
      // the latest attempt.
      await rm(join(out, "render-report.json"), { force: true });
    }

  // musicPath is an operator-LOCAL file; the remote render never stages it.
  // Fail fast, before any capture or TTS spend, rather than at the last stage.
  // Only when sound design is on: with it off the render never reads the file.
  if (opts.render && config.audio.soundDesign && config.audio.musicPath) {
    throw new Error(
      "[agent-demo-video] audio.musicPath is not supported with --render-host (the file is not staged to the remote); render locally or drop musicPath.",
    );
  }
  // 1. Parse script
  const md = readFileSync(config.script, "utf8");
  const manifest = parseScript(md);
  const shots = manifest.shots;
  const stableConfig = stableConfigJson(receiptConfig);
  const configHash = digest(stableConfig);
  const scriptHash = digest(md);
  const configSha256 = digestFull(stableConfig);
  const scriptSha256 = digestFull(md);

  // 1.5 Pre-flight selector gate — BEFORE any spend.
  //
  // Ordering is the whole point. TTS is the first thing this pipeline pays for,
  // so a selector that resolves to zero or to many must be caught above it: the
  // capture path would otherwise stall a full locator timeout mid-render and
  // then report a raw Playwright error naming neither the shot nor the
  // selector, with every narration already synthesized.
  let preflightRecord: PreflightRecord = { ran: false, declined: true, findings: 0, unverifiedShotIds: [] };
  if (config.preflight) {
    const findings = await runPreflight(manifest, config);
    if (findings.length > 0) console.warn(formatPreflightReport(findings));
    const blocking = findings.filter((f) => f.severity === "blocking");
    preflightRecord = {
      ran: true,
      declined: false,
      findings: findings.length,
      // Which shots shipped with something the gate could NOT adjudicate:
      // auth-walled live shots, selectors behind an earlier interaction, a page
      // that never settled. Keyed on severity, not on one finding kind, so the
      // receipt distinguishes "gated and clean" from "gated, but not where it
      // counted" for every reason the gate has to abstain.
      unverifiedShotIds: [...new Set(findings.filter((f) => f.severity === "info").map((f) => f.shotId))],
    };
    if (blocking.length > 0) {
      throw new Error(
        `[agent-demo-video] preflight gate failed: ${blocking.length} finding(s); no narration was synthesized. ` +
          "Fix the script, or set preflight:false / pass --no-preflight to render anyway.",
      );
    }
  } else {
    // A declined gate must be loud. Silence here would read identically to a
    // gate that ran and found nothing, which is the ambiguity the gate exists
    // to remove.
    console.warn("[agent-demo-video] preflight gate DECLINED: selectors were NOT verified before this render.");
  }

  // Preflight owns missing/invalid-clip diagnostics. Once it has passed (or was
  // explicitly declined), bind the exact clip bytes before narration or capture.
  const clipInputs = await digestPrebakedInputs(shots, config);

  // 2. Make dirs
  const audioDir = join(out, "audio");
  const segDir = join(out, "seg");
  await mkdir(audioDir, { recursive: true });
  await mkdir(segDir, { recursive: true });

  // Resolve the narration mode ONCE, before any spend, and record THAT value.
  // Re-deriving it after the render would report what the environment says now
  // rather than what produced the artifact, and could throw on a card-only run
  // that legitimately never needed a key.
  const ttsMode = resolveTtsMode();

  // 3. TTS — sequential to respect ElevenLabs concurrency limits
  const ttsResults: TtsResult[] = [];
  for (const shot of shots) {
    ttsResults.push(await synthShot(shot, config, audioDir));
  }

  // 4. Capture — one per shot; startSec unused by capture driver
  const rawSegments: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    const tts = ttsResults[i]!;
    const raw = await captureShot(shot, { shotId: shot.id, startSec: 0, durationSec: tts.durationSec }, config, segDir);
    rawSegments.push(raw);
  }
  // Prebaked capture returns the declared source path. Re-hash each source after
  // capture and before render so the report cannot bind bytes different from the
  // ones the render is about to consume.
  await assertPrebakedInputsUnchanged(clipInputs);

  // 4.4 Click offsets for sound-design ticks, read once here so remote renders
  //     get identical ticks (events files are never staged to a render host).
  const clickOffsets: number[][] = [];
  for (const shot of shots) {
    try {
      const evs = JSON.parse(await readFile(join(segDir, `events_${shot.id}.json`), "utf8")) as { kind: string; tMs: number }[];
      clickOffsets.push(evs.filter((e) => e.kind === "click").map((e) => e.tMs / 1000));
    } catch {
      clickOffsets.push([]);
    }
  }

  // 4.5 Brand cards: optional cold-open title and/or closing URL card as
  //     ordinary silent segments around the shot list (skip framing via
  //     segmentKinds). The two resolved booleans preserve brand.cards as the
  //     legacy shared default while allowing artifact-first cold opens.
  let segmentKinds: ("shot" | "card")[] = deriveSegmentKinds(shots);
  if (config.brand && (config.brand.titleCard || config.brand.endCard)) {
    const b = config.brand;
    const cardBase = {
      width: config.resolution.width,
      height: config.resolution.height,
      fps: config.fps,
      font: config.theme.captionFont,
      backdropTop: config.theme.frame.backdropTop,
      backdropBottom: config.theme.frame.backdropBottom,
      accent: b.accent,
      title: b.title,
      ...(b.subtitle ? { subtitle: b.subtitle } : {}),
      ...(b.url ? { url: b.url } : {}),
    };
    const silentCard = async (id: string, durationSec: number): Promise<TtsResult> => {
      const audioPath = join(audioDir, `${id}.mp3`);
      await ffmpeg(silentMp3Args(durationSec, audioPath));
      return { shotId: id, audioPath, durationSec, alignment: { chars: [], startSec: [], endSec: [] } };
    };
    // Operator text goes through textfile= (never inlined into a filtergraph);
    // card ids use the reserved "__" prefix the shot-id schema rejects, so a
    // shot can never clobber card artifacts.
    const titleTextFile = join(segDir, "card_title_text.txt");
    await writeFile(titleTextFile, b.title, "utf8");
    const subtitleTextFile = b.titleCard && b.subtitle ? join(segDir, "card_subtitle_text.txt") : undefined;
    if (subtitleTextFile) await writeFile(subtitleTextFile, b.subtitle!, "utf8");
    const urlTextFile = b.endCard && b.url ? join(segDir, "card_url_text.txt") : undefined;
    if (urlTextFile) await writeFile(urlTextFile, b.url!, "utf8");

    if (b.titleCard) {
      const titlePath = join(segDir, "card_title.mp4");
      await ffmpeg(titleCardArgs({ ...cardBase, durationSec: b.titleSec }, titlePath, {
        titleFile: titleTextFile,
        ...(subtitleTextFile ? { subtitleFile: subtitleTextFile } : {}),
      }));
      rawSegments.unshift(titlePath);
      ttsResults.unshift(await silentCard("__card-title", b.titleSec));
      segmentKinds.unshift("card");
      clickOffsets.unshift([]);
    }

    if (b.endCard) {
      const endPath = join(segDir, "card_end.mp4");
      await ffmpeg(endCardArgs({ ...cardBase, durationSec: b.endSec }, endPath, {
        titleFile: titleTextFile,
        ...(urlTextFile ? { urlFile: urlTextFile } : {}),
      }));
      rawSegments.push(endPath);
      ttsResults.push(await silentCard("__card-end", b.endSec));
      segmentKinds.push("card");
      clickOffsets.push([]);
    }
  }

  // 5-13. Render — locally by default, or offloaded to a render host (same renderVideo
  //       code path runs there). A remote failure rejects loudly (no silent local fallback).
  // Raw shot segments are captured at the VIEWPORT geometry; the render frames
  // them into the canvas, keeping the viewport aspect for the window.
  const inputs = { rawSegments, tts: ttsResults, config, segmentKinds, clickOffsets, contentSize: captureViewport(config) };
  let result: RenderResult;
  if (opts.render) {
    const bundlePath = opts.render.bundlePath ?? defaultBundlePath();
    if (!existsSync(bundlePath)) {
      throw new Error(`[agent-demo-video] remote render bundle not found at ${bundlePath}; run \`pnpm build:remote-entry\` first.`);
    }
    assertBundleFresh(bundlePath);
    const workDir = opts.render.workDir ?? `/tmp/agent-demo-video-render-${Date.now()}-${process.pid}`;
    result = await renderRemote(inputs, { transport: opts.render.transport, bundlePath, workDir, outPath: join(out, "final.mp4") });
  } else {
    result = await renderVideo(inputs);
  }

  // This is a render gate, not best-effort provenance. If any scoped source
  // changed while the artifact was being made, fail the run before a report
  // can certify the completed bytes.
  if (opts.sourceBuild) {
    await assertSourceBuildUnchanged(opts.sourceBuild);
  }

  // 14. Provenance. Written AFTER a successful render so the file's existence
  //     means "this artifact shipped under these inputs". Never gates: a
  //     provenance failure must not discard a completed render.
  try {
    const report = buildRenderReport({
      voice: config.voice,
      ttsMode,
      configHash,
      scriptHash,
      configSha256,
      scriptSha256,
      clips: clipInputs.map(({ shotId, sha256 }) => ({ shotId, sha256 })),
      tools: await toolVersions(),
      timeline: result.report.timeline,
      render: result.report,
      maxDurationSec: config.maxDurationSec,
      renderedOn: opts.render ? "remote" : "local",
      preflight: preflightRecord,
      ...(opts.sourceBuild
        ? { sourceBuildAttestation: opts.sourceBuild.attestation }
        : {}),
    });
    await persistRenderReport(
      join(out, "render-report.json"),
      report,
      Boolean(opts.sourceBuild),
    );
  } catch (e) {
    if (opts.sourceBuild) {
      if ((e as Error).message.includes("required render-report.json")) {
        throw e;
      }
      throw new Error(
        `[agent-demo-video] required render-report.json could not be built: ${(e as Error).message}`,
        { cause: e },
      );
    }
    console.warn(`[agent-demo-video] could not write render-report.json: ${(e as Error).message}`);
  }

    if (freshClaim) {
      await publishFreshOutput(freshClaim);
      return { ...result, outPath: join(requestedOut, "final.mp4") };
    }
    return result;
  } catch (error) {
    // Match the historical diagnostic behavior: a failed fresh run still
    // exposes its partial artifacts at the requested path when that can be
    // done without touching a competing target. A publication-integrity error
    // is added to the original failure instead of being silently swallowed.
    if (freshClaim && !freshClaim.publishAttempted) {
      try {
        await publishFreshOutput(freshClaim);
      } catch (publishError) {
        throw new Error(
          `${(error as Error).message}; additionally, ${(publishError as Error).message}`,
          { cause: error },
        );
      }
    }
    throw error;
  } finally {
    await freshClaim?.stagingHandle.close().catch(() => {});
    await freshClaim?.claimHandle.close().catch(() => {});
    await freshClaim?.parentHandle.close().catch(() => {});
  }
}
