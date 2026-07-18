import { spawn } from "node:child_process";

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

export function normalizeArgs(input: string, output: string, o: { width: number; height: number; fps: number }): string[] {
  const vf = `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2,fps=${o.fps},format=yuv420p`;
  return [...BASE, "-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", output];
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

export function subtitlesFilterPath(filePath: string): string {
  if (/[\r\n]/.test(filePath)) {
    throw new Error("ffmpeg subtitles filter paths cannot contain newlines");
  }
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\\\\\'");
}

export function concatAudioArgs(listFile: string, output: string): string[] {
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", output];
}

export function muxArgs(video: string, audio: string, output: string): string[] {
  return [...BASE, "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-shortest", output];
}

export function burnSubsArgs(video: string, srt: string, output: string, style = "FontName=Arial,FontSize=24"): string[] {
  return [...BASE, "-i", video, "-vf", `subtitles=${srt}:force_style='${style}'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", output];
}

/**
 * Encode a screencast frame sequence (concat-demuxer list with per-frame
 * durations) straight to H.264. `motionVf` (optional) is inserted after the
 * scale/pad normalization and before CFR resampling — the zoom-on-action hook.
 */
export function framesEncodeArgs(
  listFile: string,
  output: string,
  o: { width: number; height: number; fps: number; motionVf?: string },
): string[] {
  const chain = [
    `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease`,
    `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2`,
    ...(o.motionVf ? [o.motionVf] : []),
    `fps=${o.fps}`,
    "format=yuv420p",
  ];
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-vf", chain.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", output];
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
  return [...BASE, "-i", input, "-vf", `tpad=stop_mode=clone:stop_duration=${addSec}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", output];
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

export async function probeDurationSec(file: string): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? res(parseFloat(out.trim())) : rej(new Error(`ffprobe ${file} exited ${c}`))));
  });
}
