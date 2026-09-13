import { spawn } from "node:child_process";
import type { DeliverableProbe } from "./verify";

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

/**
 * The single video-encode policy (specs/shorts-platform-profile-spec.md AC5).
 * crfFrames feeds the screencast frame-sequence encode, the master generation
 * of each shot, so it is tighter; crfComposite covers every later re-encode
 * (normalize, framing composite, cards, extend, caption burn). Historical
 * inline values preserved exactly.
 */
export const X264 = { preset: "veryfast", crfFrames: "18", crfComposite: "20" } as const;

/** The shared libx264 stanza every encode site splices. */
export function x264Args(crf: string): string[] {
  return ["-c:v", "libx264", "-preset", X264.preset, "-crf", crf];
}

export function normalizeArgs(
  input: string,
  output: string,
  o: { width: number; height: number; fps: number; fadeInSec?: number },
): string[] {
  const fade = o.fadeInSec && o.fadeInSec > 0 ? `,fade=t=in:st=0:d=${o.fadeInSec}` : "";
  const vf = `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2,fps=${o.fps}${fade},format=yuv420p`;
  // probeSizePx validates v:0. Pin normalization to the same stream so a
  // multi-video container cannot pass geometry on one stream while ffmpeg's
  // automatic selection renders a larger, different-aspect stream.
  return [...BASE, "-i", input, "-map", "0:v:0", "-vf", vf, ...x264Args(X264.crfComposite), "-an", output];
}

export function concatArgs(listFile: string, output: string): string[] {
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output];
}

export function concatListEntry(filePath: string): string {
  if (/[\r\n]/.test(filePath)) {
    throw new Error("ffmpeg concat list paths cannot contain newlines");
  }
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export function concatListContent(filePaths: string[]): string {
  return filePaths.map(concatListEntry).join("\n");
}

/**
 * Escape a path for use inside a filtergraph option value: the option-level
 * specials (colon, quote, backslash) plus the graph-level separators (comma,
 * semicolon, link-label brackets) that would otherwise split the chain.
 */
export function filterPathEscape(filePath: string): string {
  if (/[\r\n]/.test(filePath)) {
    throw new Error("ffmpeg filter paths cannot contain newlines");
  }
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\\\\\'")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

export function subtitlesFilterPath(filePath: string): string {
  return filterPathEscape(filePath);
}

export function concatAudioArgs(listFile: string, output: string): string[] {
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", output];
}

/**
 * The audio is padded (`apad`) so the video is always the shortest stream and
 * `-shortest` ends the file with it. Without the pad, an audio track even a few ms
 * short made ffmpeg end a stream-copied B-frame video early, dropping up to a
 * B-frame group of trailing frames (specs/deliverable-verification-spec.md).
 */
export function muxArgs(video: string, audio: string, output: string): string[] {
  return [...BASE, "-i", video, "-i", audio, "-c:v", "copy", "-af", "apad", "-c:a", "aac", "-shortest", output];
}

export function burnSubsArgs(video: string, subPath: string, output: string, style?: string): string[] {
  // ASS files carry embedded styles; force_style is only for bare SRT.
  const vf = style ? `subtitles=${subPath}:force_style='${style}'` : `subtitles=${subPath}`;
  return [...BASE, "-i", video, "-vf", vf, ...x264Args(X264.crfComposite), "-c:a", "aac", output];
}

/**
 * Encode a screencast frame sequence (concat-demuxer list with per-frame
 * durations) straight to H.264. `motionVf` (optional, zoompan) is inserted
 * AFTER CFR resampling: on the VFR concat input zoompan would discard the
 * per-frame durations (a long-held still would collapse to one frame), so the
 * zoom hook must see constant-rate frames where input time == capture time.
 */
export function framesEncodeArgs(
  listFile: string,
  output: string,
  o: { width: number; height: number; fps: number; motionVf?: string },
): string[] {
  const chain = [
    `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease`,
    `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${o.fps}`,
    ...(o.motionVf ? [o.motionVf] : []),
    "format=yuv420p",
  ];
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-vf", chain.join(","), ...x264Args(X264.crfFrames), "-an", output];
}

export function padAudioArgs(input: string, output: string, durationSec: number): string[] {
  return [...BASE, "-i", input, "-af", "apad", "-t", String(durationSec), "-c:a", "libmp3lame", output];
}

/**
 * Extend a (silent) video segment by freezing its last frame for `addSec` more
 * seconds. Used when a prebaked clip is shorter than its narration so the segment
 * occupies the full narration window and the voiceover is not truncated.
 */
export function extendVideoArgs(input: string, output: string, addSec: number): string[] {
  return [...BASE, "-i", input, "-vf", `tpad=stop_mode=clone:stop_duration=${addSec}`, ...x264Args(X264.crfComposite), "-an", output];
}

export function silentMp3Args(durationSec: number, output: string): string[] {
  return [...BASE, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(durationSec), "-c:a", "libmp3lame", output];
}

export function run(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${bin} exited ${code}: ${err.slice(0, 800)}`))));
  });
}

export const ffmpeg = (args: string[]) => run("ffmpeg", args);

/** First video stream's square-pixel DISPLAY WxH, feeding the framed-aspect
 *  guard: coded size with any 90/270 display rotation (matrix side data or
 *  legacy rotate tag), matching what ffmpeg's autorotation feeds the filter
 *  graph. Anamorphic input is rejected because the current normalize and frame
 *  filter chains operate on coded geometry; accepting display-equivalent SAR
 *  would let the guard approve a composition that later renders stretched or
 *  padded.
 *  Phone footage is routinely landscape-coded portrait. Unparseable output
 *  rejects (fail closed) rather than defaulting to a geometry. */
export async function probeSizePx(file: string): Promise<{ width: number; height: number }> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation",
      "-of", "json",
      file,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    // A missing or non-executable ffprobe emits 'error', never 'close': unlistened
    // it throws unhandled and leaves this promise pending, so the geometry guard
    // hangs instead of failing closed.
    p.on("error", (e) => rej(new Error(`ffprobe size ${file}: ${e.message}`)));
    p.on("close", (c) => {
      try {
        if (c !== 0) throw new Error(`exited ${c}`);
        const st = JSON.parse(out).streams?.[0];
        if (!st || typeof st.width !== "number" || typeof st.height !== "number") throw new Error("no video stream geometry");
        const sar = /^(\d+):(\d+)$/.exec(st.sample_aspect_ratio ?? "");
        if (!sar) throw new Error("missing or invalid sample aspect ratio");
        const sarNumerator = Number.parseInt(sar[1]!, 10);
        const sarDenominator = Number.parseInt(sar[2]!, 10);
        if (sarNumerator <= 0 || sarDenominator <= 0 || sarNumerator !== sarDenominator) {
          throw new Error(
            `non-square sample aspect ratio ${st.sample_aspect_ratio}; ` +
            "finished compositions must use square pixels",
          );
        }
        let rot = 0;
        for (const sd of st.side_data_list ?? []) if (typeof sd.rotation === "number") rot = sd.rotation;
        const tag = Number.parseInt(st.tags?.rotate ?? "", 10);
        if (!Number.isNaN(tag)) rot = tag;
        const swap = Math.abs(rot) % 180 === 90;
        res(swap ? { width: st.height, height: st.width } : { width: st.width, height: st.height });
      } catch (e) {
        rej(new Error(`ffprobe size ${file}: ${(e as Error).message}`));
      }
    });
  });
}

/** Every property the deliverable contract compares, read from the encoded file
 *  (specs/deliverable-verification-spec.md). Unparseable output or a failed
 *  ffprobe rejects: a contract that could not be read is never reported as met. */
export async function probeDeliverable(file: string): Promise<DeliverableProbe> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", (e) => rej(new Error(`ffprobe deliverable ${file}: ${e.message}`)));
    p.on("close", (c) => {
      try {
        if (c !== 0) throw new Error(`exited ${c}`);
        const j = JSON.parse(out) as {
          streams?: Array<Record<string, unknown>>;
          format?: { duration?: string };
        };
        if (!Array.isArray(j.streams)) throw new Error("no stream list");
        const video = j.streams.filter((s) => s.codec_type === "video");
        const audio = j.streams.filter((s) => s.codec_type === "audio");
        const str = (v: unknown) => (typeof v === "string" ? v : null);
        const num = (v: unknown) => (typeof v === "number" ? v : null);
        const seconds = (v: unknown) => {
          const n = Number.parseFloat(typeof v === "string" ? v : "");
          return Number.isFinite(n) ? n : null;
        };
        res({
          videoStreams: video.length,
          audioStreams: audio.length,
          videoCodec: str(video[0]?.codec_name),
          pixFmt: str(video[0]?.pix_fmt),
          width: num(video[0]?.width),
          height: num(video[0]?.height),
          frameRate: str(video[0]?.r_frame_rate),
          avgFrameRate: str(video[0]?.avg_frame_rate),
          sampleAspectRatio: str(video[0]?.sample_aspect_ratio),
          audioCodec: str(audio[0]?.codec_name),
          durationSec: seconds(j.format?.duration),
          videoDurationSec: seconds(video[0]?.duration),
          audioDurationSec: seconds(audio[0]?.duration),
          audioSampleRate: seconds(audio[0]?.sample_rate),
        });
      } catch (e) {
        rej(new Error(`ffprobe deliverable ${file}: ${(e as Error).message}`));
      }
    });
  });
}

export async function probeDurationSec(file: string): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? res(parseFloat(out.trim())) : rej(new Error(`ffprobe ${file} exited ${c}`))));
  });
}
