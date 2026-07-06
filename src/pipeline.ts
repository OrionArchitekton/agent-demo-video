import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DemoConfig, TtsResult } from "./types";
import { parseScript } from "./parse-script";
import { synthShot } from "./tts";
import { captureShot } from "./capture";
import { renderVideo, type RenderResult } from "./render";

export async function runPipeline(config: DemoConfig): Promise<RenderResult> {
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

  // 5-13. Render — extracted to renderVideo so the same code path can run on a
  //       remote render host (see src/remote-render.ts); local render is the default.
  return renderVideo({ rawSegments, tts: ttsResults, config });
}
