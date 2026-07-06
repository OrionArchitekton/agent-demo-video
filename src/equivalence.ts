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
  const durationSec = parseFloat(probe.format?.duration);
  if (Number.isNaN(durationSec)) throw new Error("ffprobe output has invalid or missing duration");
  return {
    durationSec,
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
    p.stdout?.on("data", (d) => (stdout += d));
    p.stderr?.on("data", (d) => (stderr += d));
    // Surface spawn failures (e.g. ffmpeg/ffprobe missing) as a non-zero exit so
    // callers fail fast with a clear error instead of hanging forever.
    p.on("error", (e) => res({ stdout, stderr: `failed to start ${bin}: ${e.message}`, code: 127 }));
    p.on("close", (code) => res({ stdout, stderr, code: code ?? 1 }));
  });
}

export async function probeVideoMeta(path: string): Promise<VideoMeta> {
  const { stdout, code } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", path]);
  if (code !== 0) throw new Error(`ffprobe failed for ${path}`);
  return parseVideoMeta(JSON.parse(stdout));
}

/** SSIM (0..1) of the single frame sampled at timestamp `t` from each video. */
async function frameSsimAt(a: string, b: string, t: number): Promise<number> {
  const ts = t.toFixed(3);
  const { stderr, code } = await run("ffmpeg", [
    "-hide_banner", "-ss", ts, "-i", a, "-ss", ts, "-i", b, "-frames:v", "1", "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-",
  ]);
  if (code !== 0) throw new Error(`ffmpeg ssim failed (exit ${code}) at t=${ts}s: ${stderr.slice(0, 400).trim()}`);
  return parseSsimAll(stderr);
}

/**
 * Minimum per-frame SSIM across `n` frames evenly sampled over `durationSec`.
 * Per-frame (not a whole-video aggregate) so a localized caption/font mismatch
 * cannot be averaged away.
 */
export async function sampledFrameSsim(a: string, b: string, durationSec: number, n = 3): Promise<number> {
  const ssims: number[] = [];
  for (let i = 1; i <= n; i++) {
    ssims.push(await frameSsimAt(a, b, (durationSec * i) / (n + 1)));
  }
  return Math.min(...ssims);
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
 * (minimum SSIM across N evenly sampled frames >= ssimMin). Structural checks
 * alone miss caption/font drift; the per-frame SSIM catches it.
 */
export async function assertEquivalent(
  a: string,
  b: string,
  opts: { ssimMin?: number; frames?: number } = {},
): Promise<EquivalenceResult> {
  const ssimMin = opts.ssimMin ?? 0.98;
  const nFrames = opts.frames ?? 3;
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
  const ssim = await sampledFrameSsim(a, b, Math.min(ma.durationSec, mb.durationSec), nFrames);
  if (ssim < ssimMin) problems.push(`min sampled-frame ssim ${ssim.toFixed(4)} < ${ssimMin}`);
  return { ok: problems.length === 0, problems, ssim, a: ma, b: mb };
}
