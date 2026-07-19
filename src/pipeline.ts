import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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

export interface RunPipelineOpts {
  /** Offload the render stage to a remote host over the given transport. Absent = local render (default). */
  render?: { transport: Transport; bundlePath?: string; workDir?: string };
}

/** Path to the built remote-render bundle, resolved relative to this module. */
function defaultBundlePath(): string {
  return fileURLToPath(new URL("../dist-remote/remote-entry.js", import.meta.url));
}

export async function runPipeline(config: DemoConfig, opts: RunPipelineOpts = {}): Promise<RenderResult> {
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
    const silentCard = async (id: string, durationSec: number, videoPath: string): Promise<TtsResult> => {
      const audioPath = join(audioDir, `${id}.mp3`);
      await ffmpeg(silentMp3Args(durationSec, audioPath));
      return { shotId: id, audioPath, durationSec, alignment: { chars: [], startSec: [], endSec: [] } };
    };
    const titlePath = join(segDir, "card_title.mp4");
    await ffmpeg(titleCardArgs({ ...cardBase, durationSec: b.titleSec }, titlePath));
    const endPath = join(segDir, "card_end.mp4");
    await ffmpeg(endCardArgs({ ...cardBase, durationSec: b.endSec }, endPath));

    rawSegments.unshift(titlePath);
    ttsResults.unshift(await silentCard("card-title", b.titleSec, titlePath));
    segmentKinds.unshift("card");
    rawSegments.push(endPath);
    ttsResults.push(await silentCard("card-end", b.endSec, endPath));
    segmentKinds.push("card");
  }

  // 5-13. Render — locally by default, or offloaded to a render host (same renderVideo
  //       code path runs there). A remote failure rejects loudly (no silent local fallback).
  const inputs = { rawSegments, tts: ttsResults, config, segmentKinds };
  if (opts.render) {
    const bundlePath = opts.render.bundlePath ?? defaultBundlePath();
    if (!existsSync(bundlePath)) {
      throw new Error(`[agent-demo-video] remote render bundle not found at ${bundlePath}; run \`pnpm build:remote-entry\` first.`);
    }
    const workDir = opts.render.workDir ?? `/tmp/agent-demo-video-render-${Date.now()}-${process.pid}`;
    return renderRemote(inputs, { transport: opts.render.transport, bundlePath, workDir, outPath: join(out, "final.mp4") });
  }
  return renderVideo(inputs);
}
