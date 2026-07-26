import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { probeDurationSec } from "../src/ffmpeg";
import { DemoConfigSchema } from "../src/types";

describe("runPipeline (smoke, FAKE_TTS)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("produces final.mp4 from a 2-shot script + fixture page", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe's-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), resolution: { width: 1280, height: 720 } });
    const r = await runPipeline(cfg);
    expect(r.outPath.endsWith("final.mp4")).toBe(true);
    expect((await stat(r.outPath)).size).toBeGreaterThan(0);
    expect(r.report.parity.ok).toBe(true);
    expect(await probeDurationSec(r.outPath)).toBeLessThanOrEqual(cfg.maxDurationSec);

    // S4: the receipt must actually be written. Deleting the write previously
    // left the whole suite green.
    const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
    expect(report.ttsMode).toBe("fake");
    expect(report.limits.maxDurationSec).toBe(300);
    expect(report.voice.modelId).toBe(cfg.voice.modelId);
    expect(report.timeline.entries.length).toBe(r.report.segments);
    // The recorded timeline must be the MEASURED one, so it can explain a
    // runtime change rather than restating the narration estimate.
    expect(report.timeline.totalSec).toBeCloseTo(r.report.totalSec, 3);
    expect(report.tools.ffmpeg).not.toBe("");
  }, 120_000);

  it("S3: enforces a DECLARED cap below the produced runtime, before it can ship", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-cap-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    // 1s is below anything this fixture can render, so the cap MUST reject.
    // Binds config.maxDurationSec to enforcement: reverting render.ts to a
    // hardcoded 300 previously kept every test green.
    const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), resolution: { width: 1280, height: 720 }, maxDurationSec: 1 });
    await expect(runPipeline(cfg)).rejects.toThrow(/exceeds max 1s/);
  }, 120_000);

  it("S4: leaves no stale receipt beside a render that failed its cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-stale-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const out = join(dir, "out");
    const base = { script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out, resolution: { width: 1280, height: 720 } };
    await runPipeline(DemoConfigSchema.parse(base));
    expect(JSON.parse(await readFile(join(out, "render-report.json"), "utf8")).render.parity.ok).toBe(true);
    // Same out dir, now over-cap: final.mp4 is overwritten before parity throws,
    // so the previous run's passing receipt must not survive to describe it.
    await expect(runPipeline(DemoConfigSchema.parse({ ...base, maxDurationSec: 1 }))).rejects.toThrow();
    await expect(stat(join(out, "render-report.json"))).rejects.toThrow();
  }, 240_000);
});
