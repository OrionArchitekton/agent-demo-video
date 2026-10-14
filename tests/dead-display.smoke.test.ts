import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

describe("headless capture with a dead desktop display", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("renders while DISPLAY and WAYLAND_DISPLAY point at nothing", { timeout: 180_000 }, async () => {
    const prevDisplay = process.env.DISPLAY;
    const prevWayland = process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":99";
    process.env.WAYLAND_DISPLAY = "wayland-dead";
    try {
      const dir = await mkdtemp(join(tmpdir(), "dead-display-"));
      const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
      const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
      const scriptPath = join(dir, "demo.md");
      await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
      const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), resolution: { width: 1280, height: 720 } });
      const r = await runPipeline(cfg, { requireFreshOut: true });
      expect(r.report.parity.ok).toBe(true);
    } finally {
      if (prevDisplay === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = prevDisplay;
      if (prevWayland === undefined) delete process.env.WAYLAND_DISPLAY; else process.env.WAYLAND_DISPLAY = prevWayland;
    }
  });
});
