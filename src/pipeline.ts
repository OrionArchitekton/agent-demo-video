import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DemoConfig, TtsResult } from "./types";
import { parseScript } from "./parse-script";
import { synthShot } from "./tts";
import { captureShot } from "./capture";
import {
  ffmpeg,
  normalizeArgs,
  concatArgs,
  concatAudioArgs,
  muxArgs,
  burnSubsArgs,
  padAudioArgs,
  extendVideoArgs,
  probeDurationSec,
} from "./ffmpeg";
import { toSrt, captionStyle } from "./captions";
import { buildTimeline, reconcileSegmentDuration } from "./timeline";
import { verifyParity } from "./verify";

// Float/probe equality floor (seconds) — NOT a truncation budget. Any clip measurably
// shorter than its narration is extended so the voiceover is never cut, however small
// the deficit; only a shortfall below this (i.e. the two measurements are equal to
// within ffprobe float precision) is treated as "clip already covers the narration".
const EXTEND_EPS_SEC = 1e-6;

export async function runPipeline(
  config: DemoConfig,
): Promise<{
  outPath: string;
  report: {
    totalSec: number;
    segments: number;
    parity: { ok: boolean; problems: string[] };
  };
}> {
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
    const tts = await synthShot(shot, config, audioDir);
    ttsResults.push(tts);
  }

  // 4. Capture — one per shot; startSec unused by capture driver
  const rawSegments: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    const tts = ttsResults[i]!;
    const raw = await captureShot(
      shot,
      { shotId: shot.id, startSec: 0, durationSec: tts.durationSec },
      config,
      segDir,
    );
    rawSegments.push(raw);
  }

  // 5. Normalize each raw segment to a uniformly-encoded mp4
  const segMp4s: string[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const raw = rawSegments[i]!;
    const segMp4 = join(segDir, `seg_${i}.mp4`);
    await ffmpeg(
      normalizeArgs(raw, segMp4, {
        width: config.resolution.width,
        height: config.resolution.height,
        fps: config.fps,
      }),
    );
    segMp4s.push(segMp4);
  }

  // 6. Measure each normalized segment duration and reconcile it against the
  //    narration window. Live capture dwells, so the clip already fills the
  //    narration; a PREBAKED clip has no dwell and may be shorter — extend it
  //    (freeze the last frame) so the authoritative duration is never below the
  //    narration and the voiceover is not silently truncated downstream.
  const durSecs: number[] = [];
  for (let i = 0; i < segMp4s.length; i++) {
    const clipSec = await probeDurationSec(segMp4s[i]!);
    const narrationSec = ttsResults[i]!.durationSec;
    const { durationSec: authoritativeSec, extendBySec } = reconcileSegmentDuration(clipSec, narrationSec);
    if (extendBySec > EXTEND_EPS_SEC) {
      const extended = join(segDir, `seg_${i}.ext.mp4`);
      // tpad clones WHOLE frames and can round the added duration down, which would
      // leave the segment a hair under the narration and re-truncate the tail when
      // the audio is later capped to this segment's duration. Add a one-frame safety
      // margin so the extended video provably covers the full narration window.
      const frameSec = 1 / config.fps;
      await ffmpeg(extendVideoArgs(segMp4s[i]!, extended, extendBySec + frameSec));
      segMp4s[i] = extended;
      const extendedSec = await probeDurationSec(extended);
      // Never record below the narration even if tpad frame-rounding undershot the
      // target, so the audio pad target downstream can never cap the voiceover.
      durSecs.push(Math.max(extendedSec, narrationSec));
      console.warn(
        `[agent-demo-video] shot "${shots[i]!.id}": prebaked clip (${clipSec.toFixed(2)}s) is shorter than its ` +
          `narration (${narrationSec.toFixed(2)}s); froze the last frame to extend it to ` +
          `${extendedSec.toFixed(2)}s so the voiceover is not truncated.`,
      );
    } else {
      // Clip already covers the narration (within float-measurement equality);
      // record max(clip, narration) so the audio is never capped below narration.
      durSecs.push(authoritativeSec);
    }
  }
  const timeline = buildTimeline(
    shots.map((s, i) => ({ shotId: s.id, durationSec: durSecs[i]! })),
  );

  // 7. Build + write captions
  const srt = toSrt(
    ttsResults.map((t, i) => ({
      alignment: t.alignment,
      startSec: timeline.entries[i]!.startSec,
    })),
  );
  const srtPath = join(out, "captions.srt");
  await writeFile(srtPath, srt, "utf8");

  // 8. Pad each audio track to exactly the corresponding video segment duration
  const paddedAudioPaths: string[] = [];
  for (let i = 0; i < ttsResults.length; i++) {
    const paddedAudio = join(audioDir, `pad_${i}.mp3`);
    await ffmpeg(padAudioArgs(ttsResults[i]!.audioPath, paddedAudio, durSecs[i]!));
    paddedAudioPaths.push(paddedAudio);
  }

  // 9. Concat video segments
  const videoListPath = join(segDir, "list.txt");
  const videoListContent = segMp4s
    .map((p) => `file '${p}'`)
    .join("\n");
  await writeFile(videoListPath, videoListContent, "utf8");
  const concatVideoPath = join(out, "video.mp4");
  await ffmpeg(concatArgs(videoListPath, concatVideoPath));

  // 10. Concat audio segments
  const audioListPath = join(audioDir, "list.txt");
  const audioListContent = paddedAudioPaths
    .map((p) => `file '${p}'`)
    .join("\n");
  await writeFile(audioListPath, audioListContent, "utf8");
  const concatAudioPath = join(out, "audio.mp3");
  await ffmpeg(concatAudioArgs(audioListPath, concatAudioPath));

  // 11. Mux video + audio
  const muxedPath = join(out, "muxed.mp4");
  await ffmpeg(muxArgs(concatVideoPath, concatAudioPath, muxedPath));

  // 12. Burn subtitles
  //     Use a relative path from cwd for the srt to avoid ffmpeg colon-in-path issues
  //     (Windows-style absolute paths with drive letters break the subtitles filter).
  //     We write captions.srt inside `out` and reference it via its absolute path,
  //     escaping any colons that appear on Windows. On Linux/WSL paths are clean.
  const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const finalPath = join(out, "final.mp4");
  await ffmpeg(burnSubsArgs(muxedPath, escapedSrt, finalPath, captionStyle(config.theme)));

  // 13. Parity check
  const videoSec = await probeDurationSec(finalPath);
  const audioSec = await probeDurationSec(concatAudioPath);
  const parity = verifyParity({
    shotCount: shots.length,
    videoSegments: segMp4s.length,
    audioSec,
    videoSec,
    maxSec: 300,
  });

  if (!parity.ok) {
    throw new Error("parity failed: " + parity.problems.join("; "));
  }

  return {
    outPath: finalPath,
    report: {
      totalSec: timeline.totalSec,
      segments: segMp4s.length,
      parity,
    },
  };
}
