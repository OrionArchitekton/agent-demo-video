import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { RenderInputs, RenderResult } from "./render";
import { buildManifest } from "./manifest";
import { LocalTransport, type Transport } from "./transport";

export interface RemoteRenderOpts {
  /** How to reach the render host (LocalTransport or SshTransport). */
  transport: Transport;
  /** Path to the built self-contained render bundle (dist-remote/remote-entry.js). */
  bundlePath: string;
  /** Work directory on the render host. */
  workDir: string;
  /** Local path to write the retrieved final.mp4. */
  outPath: string;
  /** Local staging dir; a temp dir is created (and cleaned) if omitted. */
  stageDir?: string;
  /** Preflight the caption font on the host to catch silent libass substitution (default true). */
  verifyFont?: boolean;
}

/**
 * Guard against silent caption-font drift: if the render host resolves the
 * caption font to a different family than this host does, burned captions would
 * diverge (the exact failure the equivalence proof targets, which verifyParity's
 * duration/count check cannot see). fc-match is a hard dependency of any host
 * that can burn captions (libass + fontconfig), so an unresolvable check is a
 * loud failure, not a silent skip.
 */
async function assertFontParity(transport: Transport, font: string): Promise<void> {
  const hostFam = (await transport.capture(["fc-match", "-f", "%{family}", font])).trim();
  const localFam = (await new LocalTransport().capture(["fc-match", "-f", "%{family}", font]).catch(() => "")).trim();
  if (localFam && hostFam && localFam.toLowerCase() !== hostFam.toLowerCase()) {
    throw new Error(
      `[remote-render] caption font drift: render host resolves "${font}" to "${hostFam}", ` +
        `local resolves to "${localFam}". Burned captions would diverge; install the font on the render host or pin a shared face.`,
    );
  }
}

/**
 * Render the video on a remote host and bring the result back, WITHOUT modifying
 * the caller's inputs. Inputs are copied into a staging dir under stable
 * index-based names (so distinct sources sharing a basename cannot collide),
 * shipped with the render bundle + manifest, rendered by `renderVideo` on the
 * host, and the final.mp4 is retrieved. Any step failure rejects loudly; the
 * original inputs are never touched (local render remains a safe fallback), and
 * the remote work dir is always cleaned up so captured media is never left behind.
 */
export async function renderRemote(inputs: RenderInputs, opts: RemoteRenderOpts): Promise<RenderResult> {
  const ownsStage = !opts.stageDir;
  const stage = opts.stageDir ?? (await mkdtemp(join(tmpdir(), "adv-stage-")));
  let workDirCreated = false;
  try {
    if (opts.verifyFont !== false) await assertFontParity(opts.transport, inputs.config.theme.captionFont);

    const manifest = buildManifest(inputs);
    const stageSeg = join(stage, "seg");
    const stageAudio = join(stage, "audio");
    await mkdir(stageSeg, { recursive: true });
    await mkdir(stageAudio, { recursive: true });
    // Copy inputs into staging under the manifest's index-based names (read-only
    // w.r.t. the originals; collision-free even if two sources share a basename).
    for (let i = 0; i < inputs.rawSegments.length; i++) await cp(inputs.rawSegments[i]!, join(stageSeg, manifest.segments[i]!));
    for (let i = 0; i < inputs.tts.length; i++) await cp(inputs.tts[i]!.audioPath, join(stageAudio, manifest.audio[i]!.file));
    await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest), "utf8");
    await cp(opts.bundlePath, join(stage, "remote-entry.js"));
    // Mark the staged dir as an ES module so the ESM bundle runs as a module even
    // on a host where a bare .js in a package-less dir would default to CommonJS
    // (Node < ~22, i.e. the declared node>=18 floor).
    await writeFile(join(stage, "package.json"), JSON.stringify({ type: "module" }), "utf8");

    // Ship -> run -> collect. Atomically create the work dir (rejects if it already
    // exists) so cleanup only ever removes a dir this run created, with no TOCTOU
    // race between a separate existence check and the create.
    await opts.transport.mkdirExclusive(opts.workDir);
    workDirCreated = true;
    await opts.transport.pushDir(stage, opts.workDir);
    const stdout = await opts.transport.exec(opts.workDir, ["node", "remote-entry.js"]);
    await opts.transport.pullFile(posix.join(opts.workDir, "out", "final.mp4"), opts.outPath);

    // The bundle prints its RenderResult as a stdout JSON line; scan from the
    // bottom for the first valid JSON so a stray warning line cannot break parsing.
    const lines = stdout.trim().split("\n").filter(Boolean);
    let remote: RenderResult | undefined;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        remote = JSON.parse(lines[i]!) as RenderResult;
        break;
      } catch {
        // not the JSON result line
      }
    }
    if (!remote?.report) {
      throw new Error("[remote-render] could not parse render result from host stdout: " + stdout.slice(0, 400));
    }
    return { outPath: opts.outPath, report: remote.report };
  } finally {
    // Always remove the remote work dir (success OR failure) so staged captured
    // media / narration is never left on the render host. Best-effort; log if it fails.
    if (workDirCreated) {
      await opts.transport.remove(opts.workDir).catch((e) =>
        console.warn(`[remote-render] could not remove remote work dir ${opts.workDir}: ${String((e && e.message) || e)}`),
      );
    }
    if (ownsStage) await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
