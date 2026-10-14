import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";
import { checkMotionRequirements } from "../src/motion-cards/requirements";

const reqs = checkMotionRequirements();

async function render(brand: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "motion-"));
  const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
  const scriptPath = join(dir, "demo.md");
  await writeFile(scriptPath, (await readFile(resolve("tests/fixtures/demo.md"), "utf8")).replaceAll("FIXTURE_URL", fixture));
  const out = join(dir, "out");
  const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out, platform: "shorts", brand });
  const r = await runPipeline(cfg, { requireFreshOut: true });
  const report = JSON.parse(await readFile(join(out, "render-report.json"), "utf8"));
  return { dir, out, r, report };
}

/** Fraction of pixels with luma > 200 in the band [y0,y1) of the first frame. */
function brightShare(video: string, w: number, h: number, y0: number, y1: number): number {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-frames:v", "1", "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (buf[y * w + x]! > 200) n++;
  return n / ((y1 - y0) * w);
}

describe.skipIf(!reqs.ok)("motion cards (smoke)", { timeout: 600_000 }, () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.FAKE_TTS; process.env.FAKE_TTS = "1"; });
  afterEach(() => { if (prev === undefined) delete process.env.FAKE_TTS; else process.env.FAKE_TTS = prev; });

  it("renders HyperFrames title and end cards that pass parity and deliverable checks, with the hook on frame 0", async () => {
    const { out, r, report } = await render({ title: "Demo Fixture", subtitle: "Ask once", url: "example.com", hook: "Stop pasting secrets", motion: true });
    expect(r.report.parity.ok).toBe(true);
    expect(report.deliverable.ok).toBe(true);
    expect(report.motionCards).toEqual({ renderer: "hyperframes", version: "0.8.155" });
    expect(report.hook).toBe("set");
    // Hook region: the central band of the 1080x1920 frame, where the hook is drawn.
    expect(brightShare(join(out, "final.mp4"), 540, 960, 300, 700)).toBeGreaterThanOrEqual(0.01);
  });

  it("records no motionCards key when motion is off", async () => {
    const { report } = await render({ title: "Demo Fixture", hook: "Stop pasting secrets" });
    expect("motionCards" in report).toBe(false);
  });
});
