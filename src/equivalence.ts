import { spawn } from "node:child_process";

export interface VideoMeta {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  vcodec: string;
  acodec: string;
  streamCount: number;
}

/** Parse `ffprobe -show_format -show_streams -print_format json` output. */
export function parseVideoMeta(probe: any): VideoMeta {
  const streams = probe?.streams ?? [];
  const v = streams.find((s: any) => s.codec_type === "video");
  const a = streams.find((s: any) => s.codec_type === "audio");
  if (!v) throw new Error("ffprobe output has no video stream");
  const parts = String(v.avg_frame_rate ?? "0/1").split("/").map(Number);
  const num = parts[0] ?? 0;
  const den = parts[1] ?? 1;
  const fps = den ? num / den : num;
  return {
    durationSec: parseFloat(probe.format?.duration),
    width: v.width,
    height: v.height,
    fps,
    vcodec: v.codec_name,
    acodec: a?.codec_name ?? "",
    streamCount: streams.length,
  };
}

/** Read the `All:` value from the ffmpeg `ssim` filter summary (printed to stderr). */
export function parseSsimAll(stderr: string): number {
  const m = stderr.match(/SSIM[^\n]*\bAll:([0-9.]+)/);
  if (!m) throw new Error("no SSIM All: value found in ffmpeg output");
  return parseFloat(m[1]!);
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const p = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => res({ stdout, stderr, code: code ?? 1 }));
  });
}

export async function probeVideoMeta(path: string): Promise<VideoMeta> {
  const { stdout, code } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", path]);
  if (code !== 0) throw new Error(`ffprobe failed for ${path}`);
  return parseVideoMeta(JSON.parse(stdout));
}

/** Whole-video structural-similarity (0..1) between two renders via the ffmpeg ssim filter. */
export async function videoSsim(a: string, b: string): Promise<number> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"]);
  return parseSsimAll(stderr);
}

export interface EquivalenceResult {
  ok: boolean;
  problems: string[];
  ssim: number;
  a: VideoMeta;
  b: VideoMeta;
}

/**
 * Two rendered videos are equivalent when they match structurally (duration
 * within one frame, identical resolution/fps/codecs/stream count) AND visually
 * (whole-video SSIM >= ssimMin). Structural checks alone miss caption/font
 * drift; SSIM catches it.
 */
export async function assertEquivalent(
  a: string,
  b: string,
  opts: { ssimMin?: number } = {},
): Promise<EquivalenceResult> {
  const ssimMin = opts.ssimMin ?? 0.98;
  const ma = await probeVideoMeta(a);
  const mb = await probeVideoMeta(b);
  const problems: string[] = [];
  const frameSec = ma.fps ? 1 / ma.fps : 1 / 30;
  if (Math.abs(ma.durationSec - mb.durationSec) > frameSec + 1e-6)
    problems.push(`duration ${ma.durationSec}s vs ${mb.durationSec}s (> 1 frame)`);
  if (ma.width !== mb.width || ma.height !== mb.height)
    problems.push(`resolution ${ma.width}x${ma.height} vs ${mb.width}x${mb.height}`);
  if (Math.abs(ma.fps - mb.fps) > 0.01) problems.push(`fps ${ma.fps} vs ${mb.fps}`);
  if (ma.vcodec !== mb.vcodec) problems.push(`vcodec ${ma.vcodec} vs ${mb.vcodec}`);
  if (ma.acodec !== mb.acodec) problems.push(`acodec ${ma.acodec} vs ${mb.acodec}`);
  if (ma.streamCount !== mb.streamCount) problems.push(`streams ${ma.streamCount} vs ${mb.streamCount}`);
  const ssim = await videoSsim(a, b);
  if (ssim < ssimMin) problems.push(`ssim ${ssim.toFixed(4)} < ${ssimMin}`);
  return { ok: problems.length === 0, problems, ssim, a: ma, b: mb };
}
