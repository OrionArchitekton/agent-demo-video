import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline";
import { probeDurationSec } from "../src/ffmpeg";
import { estimateDurationSec } from "../src/fake-tts";
import { DemoConfigSchema } from "../src/types";

function sh(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    p.stderr.on("data", (d) => (e += d));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${bin} exited ${c}: ${e.slice(0, 400)}`))));
  });
}

describe("runPipeline (prebaked clip shorter than its narration)", () => {
  // Scope FAKE_TTS to this file and restore it after, so the env does not leak to
  // other test files in a shared worker.
  beforeAll(() => {
    vi.stubEnv("FAKE_TTS", "1");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("does not truncate the voiceover — extends the segment to the narration window", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prebaked-"));

    // A short (2s) prebaked clip — no audio, like a real captured/normalized clip.
    const clip = join(dir, "short.mp4");
    await sh("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2",
      "-c:v", "libx264", "-t", "2", "-pix_fmt", "yuv420p", clip,
    ]);

    // Narration far longer than the 2s clip, so the pipeline must extend the clip
    // (freeze last frame) rather than silently cutting the voiceover.
    const narration =
      "This narration is deliberately much longer than the two second clip so that " +
      "the pipeline has to extend the frozen final frame to avoid cutting the voiceover off.";
    const expectedSec = estimateDurationSec(narration);
    expect(expectedSec).toBeGreaterThan(4); // sanity: narration must exceed the 2s clip

    const md = `# Prebaked\n### SHOT one\n- target: prebaked\n- clip: ${clip}\n- narration: ${narration}\n`;
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, md);

    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      resolution: { width: 640, height: 360 },
    });

    const r = await runPipeline(cfg);
    const finalSec = await probeDurationSec(r.outPath);

    // Before the fix the final video is ~2s (clip length) — the voiceover is cut.
    // After the fix the segment covers the full narration window.
    expect(finalSec).toBeGreaterThanOrEqual(expectedSec - 1.0);
    expect(r.report.parity.ok).toBe(true);

    // Guard the voiceover DIRECTLY, not just the video container: assert the
    // narration audio track still covers (nearly) the full narration window. A
    // regression that cut the voiceover but left the (independently-extended)
    // video long would pass the duration-only check above but fail here.
    const audioSec = await probeDurationSec(join(dir, "out", "audio.mp3"));
    expect(audioSec).toBeGreaterThanOrEqual(expectedSec - 0.2);
  }, 120_000);

  it("does not truncate when the clip is only slightly shorter than the narration (sub-tolerance band)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prebaked-eps-"));

    // ~3.8s narration (10 words x 0.38); clip ~70ms shorter — a small but REAL
    // deficit that must not be silently dropped as "within tolerance".
    const narration = "One two three four five six seven eight nine ten";
    const expectedSec = estimateDurationSec(narration);
    const clipSec = expectedSec - 0.07;

    const clip = join(dir, "near.mp4");
    await sh("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=c=green:s=320x240:d=${clipSec}`,
      "-c:v", "libx264", "-t", String(clipSec), "-pix_fmt", "yuv420p", clip,
    ]);

    const md = `# Eps\n### SHOT one\n- target: prebaked\n- clip: ${clip}\n- narration: ${narration}\n`;
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, md);

    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      resolution: { width: 640, height: 360 },
    });

    const r = await runPipeline(cfg);

    // A ~70ms shortfall must still preserve the narration audio — the small-deficit
    // band is not an acceptable truncation budget.
    const audioSec = await probeDurationSec(join(dir, "out", "audio.mp3"));
    expect(audioSec).toBeGreaterThanOrEqual(expectedSec - 0.02);
    expect(r.report.parity.ok).toBe(true);
  }, 120_000);
});
