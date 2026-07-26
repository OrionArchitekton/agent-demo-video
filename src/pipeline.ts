import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DemoConfig, TtsResult } from "./types";
import { parseScript } from "./parse-script";
import { synthShot } from "./tts";
import { captureShot } from "./capture";
import { titleCardArgs, endCardArgs } from "./cards";
import { ffmpeg, silentMp3Args } from "./ffmpeg";
import { renderVideo, type RenderResult } from "./render";
import { renderRemote } from "./remote-render";
import type { Transport } from "./transport";
import { buildRenderReport, digest, stableConfigJson, toolVersions } from "./provenance";
import { resolveTtsMode } from "./tts";

export interface RunPipelineOpts {
  /** Offload the render stage to a remote host over the given transport. Absent = local render (default). */
  render?: { transport: Transport; bundlePath?: string; workDir?: string };
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

  // 2. Make dirs
  const out = resolve(config.out);
  const audioDir = join(out, "audio");
  const segDir = join(out, "seg");
  await mkdir(audioDir, { recursive: true });
  await mkdir(segDir, { recursive: true });

  // Resolve the narration mode ONCE, before any spend, and record THAT value.
  // Re-deriving it after the render would report what the environment says now
  // rather than what produced the artifact, and could throw on a card-only run
  // that legitimately never needed a key.
  const ttsMode = resolveTtsMode();

  // A receipt must never outlive the render it describes: final.mp4 is written
  // before the parity check throws, so a failed run could otherwise leave the
  // new video beside the PREVIOUS run's passing report.
  await rm(join(out, "render-report.json"), { force: true });

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

  // 4.5 Brand cards: cold-open title + closing URL card as ordinary silent
  //     segments around the shot list (skip framing via segmentKinds).
  let segmentKinds: ("shot" | "card")[] = shots.map(() => "shot" as const);
  if (config.brand?.cards) {
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
    const subtitleTextFile = b.subtitle ? join(segDir, "card_subtitle_text.txt") : undefined;
    if (subtitleTextFile) await writeFile(subtitleTextFile, b.subtitle!, "utf8");
    const urlTextFile = b.url ? join(segDir, "card_url_text.txt") : undefined;
    if (urlTextFile) await writeFile(urlTextFile, b.url!, "utf8");

    const titlePath = join(segDir, "card_title.mp4");
    await ffmpeg(titleCardArgs({ ...cardBase, durationSec: b.titleSec }, titlePath, {
      titleFile: titleTextFile,
      ...(subtitleTextFile ? { subtitleFile: subtitleTextFile } : {}),
    }));
    const endPath = join(segDir, "card_end.mp4");
    await ffmpeg(endCardArgs({ ...cardBase, durationSec: b.endSec }, endPath, {
      titleFile: titleTextFile,
      ...(urlTextFile ? { urlFile: urlTextFile } : {}),
    }));

    rawSegments.unshift(titlePath);
    ttsResults.unshift(await silentCard("__card-title", b.titleSec));
    segmentKinds.unshift("card");
    clickOffsets.unshift([]);
    rawSegments.push(endPath);
    ttsResults.push(await silentCard("__card-end", b.endSec));
    segmentKinds.push("card");
    clickOffsets.push([]);
  }

  // 5-13. Render — locally by default, or offloaded to a render host (same renderVideo
  //       code path runs there). A remote failure rejects loudly (no silent local fallback).
  const inputs = { rawSegments, tts: ttsResults, config, segmentKinds, clickOffsets };
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

  // 14. Provenance. Written AFTER a successful render so the file's existence
  //     means "this artifact shipped under these inputs". Never gates: a
  //     provenance failure must not discard a completed render.
  try {
    const report = buildRenderReport({
      voice: config.voice,
      ttsMode,
      configHash: digest(stableConfigJson(config)),
      scriptHash: digest(md),
      tools: await toolVersions(),
      timeline: result.report.timeline,
      render: result.report,
      maxDurationSec: config.maxDurationSec,
      renderedOn: opts.render ? "remote" : "local",
    });
    await writeFile(join(out, "render-report.json"), JSON.stringify(report, null, 2));
  } catch (e) {
    console.warn(`[agent-demo-video] could not write render-report.json: ${(e as Error).message}`);
  }

  return result;
}
