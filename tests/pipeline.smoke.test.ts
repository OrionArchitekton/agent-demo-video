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
    const dir = await mkdtemp(join(tmpdir(), "pipe-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), resolution: { width: 1280, height: 720 } });
    const r = await runPipeline(cfg);
    expect(r.outPath.endsWith("final.mp4")).toBe(true);
    expect((await stat(r.outPath)).size).toBeGreaterThan(0);
    expect(r.report.parity.ok).toBe(true);
    expect(await probeDurationSec(r.outPath)).toBeLessThanOrEqual(300);
  }, 120_000);
});
