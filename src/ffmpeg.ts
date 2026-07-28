import { spawn } from "node:child_process";

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
  return [...BASE, "-i", input, "-vf", vf, ...x264Args(X264.crfComposite), "-an", output];
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

export function muxArgs(video: string, audio: string, output: string): string[] {
  return [...BASE, "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-shortest", output];
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

/** First video stream's DISPLAY WxH, feeding the framed-aspect guard: coded
 *  size with any 90/270 display rotation applied (matrix side data or legacy
 *  rotate tag), matching what ffmpeg's autorotation feeds the filter graph.
 *  Phone footage is routinely landscape-coded portrait. Unparseable output
 *  rejects (fail closed) rather than defaulting to a geometry. */
export async function probeSizePx(file: string): Promise<{ width: number; height: number }> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation", "-of", "json", file]);
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

export async function probeDurationSec(file: string): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? res(parseFloat(out.trim())) : rej(new Error(`ffprobe ${file} exited ${c}`))));
  });
}
