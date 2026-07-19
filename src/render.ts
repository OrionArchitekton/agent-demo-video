import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DemoConfig, TtsResult } from "./types";
import {
  ffmpeg,
  normalizeArgs,
  concatArgs,
  concatListContent,
  concatAudioArgs,
  muxArgs,
  burnSubsArgs,
  subtitlesFilterPath,
  padAudioArgs,
  extendVideoArgs,
  probeDurationSec,
} from "./ffmpeg";
import { toSrt, captionStyle } from "./captions";
import { buildTimeline, reconcileSegmentDuration } from "./timeline";
import { verifyParity } from "./verify";
import { maskGenArgs, shadowGenArgs, frameArgs } from "./framing";

/** The render-affecting subset of the demo config (no capture/tts/auth fields). */
export type RenderConfig = Pick<DemoConfig, "resolution" | "fps" | "theme" | "out">;

/**
 * Everything the render stage consumes, independent of how it was produced.
 * `rawSegments` are the captured (unnormalized) video segments; `tts` carries
 * the per-shot audio path, measured duration, and caption alignment.
 */
export interface RenderInputs {
  rawSegments: string[];
  tts: TtsResult[];
  config: RenderConfig;
}

export interface RenderResult {
  outPath: string;
  report: { totalSec: number; segments: number; parity: { ok: boolean; problems: string[] } };
}

// Float/probe equality floor (seconds) — NOT a truncation budget. Any clip measurably
// shorter than its narration is extended so the voiceover is never cut, however small
// the deficit; only a shortfall below this (i.e. the two measurements are equal to
// within ffprobe float precision) is treated as "clip already covers the narration".
const EXTEND_EPS_SEC = 1e-6;

/**
 * Render stage (steps 5-13 of the pipeline): normalize captured segments,
 * reconcile durations, build + burn captions, concat, mux, and parity-check
 * into `<out>/final.mp4`. Pure with respect to capture/TTS — it consumes only
 * files + metadata, so it runs identically on the local host or a remote one
 * (see remote-render). Extracted from runPipeline so both share one code path.
 */
export async function renderVideo(inputs: RenderInputs): Promise<RenderResult> {
  const { rawSegments, tts, config } = inputs;
  const out = resolve(config.out);
  const audioDir = join(out, "audio");
  const segDir = join(out, "seg");
  // Ensure our output dirs exist. In the local pipeline these are pre-created by
  // step 2; on a remote host renderVideo may be the first to write here.
  await mkdir(segDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  // 5. Normalize each raw segment to a uniformly-encoded mp4. With framing
  //    enabled the segment is composited into the framed scene instead; the
  //    rounded mask and shadow plate are generated once and reused.
  const frame = config.theme.frame;
  const frameOpts = {
    width: config.resolution.width,
    height: config.resolution.height,
    scale: frame.scale,
    radius: frame.radius,
    backdropTop: frame.backdropTop,
    backdropBottom: frame.backdropBottom,
    shadow: frame.shadow,
  };
  let maskPng: string | null = null;
  let shadowPng: string | null = null;
  if (frame.enabled) {
    maskPng = join(segDir, "frame_mask.png");
    await ffmpeg(maskGenArgs(frameOpts, maskPng));
    if (frame.shadow) {
      shadowPng = join(segDir, "frame_shadow.png");
      await ffmpeg(shadowGenArgs(frameOpts, shadowPng));
    }
  }

  const segMp4s: string[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const segMp4 = join(segDir, `seg_${i}.mp4`);
    // Soft transition: every segment after the first opens with a brief
    // fade-in. Purely visual; duration and segment count are unchanged.
    const fadeInSec = i > 0 && config.theme.fadeInMs > 0 ? config.theme.fadeInMs / 1000 : undefined;
    if (frame.enabled && maskPng) {
      const rawSec = await probeDurationSec(rawSegments[i]!);
      await ffmpeg(
        frameArgs(rawSegments[i]!, maskPng, shadowPng, segMp4, {
          ...frameOpts,
          fps: config.fps,
          durationSec: rawSec,
          ...(fadeInSec ? { fadeInSec } : {}),
        }),
      );
    } else {
      await ffmpeg(
        normalizeArgs(rawSegments[i]!, segMp4, {
          width: config.resolution.width,
          height: config.resolution.height,
          fps: config.fps,
          ...(fadeInSec ? { fadeInSec } : {}),
        }),
      );
    }
    segMp4s.push(segMp4);
  }

  // 6. Reconcile each segment duration against its narration window; extend a
  //    short (prebaked) clip by freezing its last frame so audio is not truncated.
  const durSecs: number[] = [];
  for (let i = 0; i < segMp4s.length; i++) {
    const clipSec = await probeDurationSec(segMp4s[i]!);
    const narrationSec = tts[i]!.durationSec;
    const { durationSec: authoritativeSec, extendBySec } = reconcileSegmentDuration(clipSec, narrationSec);
    if (extendBySec > EXTEND_EPS_SEC) {
      const extended = join(segDir, `seg_${i}.ext.mp4`);
      // tpad clones WHOLE frames and can round the added duration down; add a
      // one-frame safety margin so the extended video provably covers the window.
      const frameSec = 1 / config.fps;
      await ffmpeg(extendVideoArgs(segMp4s[i]!, extended, extendBySec + frameSec));
      segMp4s[i] = extended;
      const extendedSec = await probeDurationSec(extended);
      durSecs.push(Math.max(extendedSec, narrationSec));
      console.warn(
        `[agent-demo-video] shot "${tts[i]!.shotId}": prebaked clip (${clipSec.toFixed(2)}s) is shorter than its ` +
          `narration (${narrationSec.toFixed(2)}s); froze the last frame to extend it to ` +
          `${extendedSec.toFixed(2)}s so the voiceover is not truncated.`,
      );
    } else {
      durSecs.push(authoritativeSec);
    }
  }
  const timeline = buildTimeline(tts.map((t, i) => ({ shotId: t.shotId, durationSec: durSecs[i]! })));

  // 7. Build + write captions
  const srt = toSrt(tts.map((t, i) => ({ alignment: t.alignment, startSec: timeline.entries[i]!.startSec })));
  const srtPath = join(out, "captions.srt");
  await writeFile(srtPath, srt, "utf8");

  // 8. Pad each audio track to exactly its video segment duration
  const paddedAudioPaths: string[] = [];
  for (let i = 0; i < tts.length; i++) {
    const paddedAudio = join(audioDir, `pad_${i}.mp3`);
    await ffmpeg(padAudioArgs(tts[i]!.audioPath, paddedAudio, durSecs[i]!));
    paddedAudioPaths.push(paddedAudio);
  }

  // 9. Concat video segments
  const videoListPath = join(segDir, "list.txt");
  await writeFile(videoListPath, concatListContent(segMp4s), "utf8");
  const concatVideoPath = join(out, "video.mp4");
  await ffmpeg(concatArgs(videoListPath, concatVideoPath));

  // 10. Concat audio segments
  const audioListPath = join(audioDir, "list.txt");
  await writeFile(audioListPath, concatListContent(paddedAudioPaths), "utf8");
  const concatAudioPath = join(out, "audio.mp3");
  await ffmpeg(concatAudioArgs(audioListPath, concatAudioPath));

  // 11. Mux video + audio
  const muxedPath = join(out, "muxed.mp4");
  await ffmpeg(muxArgs(concatVideoPath, concatAudioPath, muxedPath));

  // 12. Burn subtitles
  const escapedSrt = subtitlesFilterPath(srtPath);
  const finalPath = join(out, "final.mp4");
  await ffmpeg(burnSubsArgs(muxedPath, escapedSrt, finalPath, captionStyle(config.theme)));

  // 13. Parity check
  const videoSec = await probeDurationSec(finalPath);
  const audioSec = await probeDurationSec(concatAudioPath);
  const parity = verifyParity({
    shotCount: tts.length,
    videoSegments: segMp4s.length,
    audioSec,
    videoSec,
    maxSec: 300,
  });
  if (!parity.ok) throw new Error("parity failed: " + parity.problems.join("; "));

  return { outPath: finalPath, report: { totalSec: timeline.totalSec, segments: segMp4s.length, parity } };
}
