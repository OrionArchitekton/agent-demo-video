import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

async function render(extra: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "hook-"));
  const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
  const scriptPath = join(dir, "demo.md");
  await writeFile(scriptPath, (await readFile(resolve("tests/fixtures/demo.md"), "utf8")).replaceAll("FIXTURE_URL", fixture));
  const cfg = DemoConfigSchema.parse({
    script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), ...extra,
  });
  await runPipeline(cfg, { requireFreshOut: true });
  const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
  return { dir, report };
}

describe("shorts hook card (smoke)", { timeout: 180_000 }, () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.FAKE_TTS; process.env.FAKE_TTS = "1"; });
  afterEach(() => { if (prev === undefined) delete process.env.FAKE_TTS; else process.env.FAKE_TTS = prev; });

  it("records hook=set and writes the wrapped hook textfile", async () => {
    const { dir, report } = await render({ platform: "shorts", brand: { title: "Demo Fixture", hook: "Stop pasting secrets" } });
    expect(report.hook).toBe("set");
    await access(join(dir, "out", "seg", "card_hook_text_0.txt"));
  });

  it("records hook=missing and warns when a Shorts render has no hook", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      const { report } = await render({ platform: "shorts", brand: { title: "Demo Fixture" } });
      expect(report.hook).toBe("missing");
      expect(warn.mock.calls.some((c) => /no brand\.hook/.test(String(c[0])))).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it("records nothing for a landscape render without a hook", async () => {
    const { report } = await render({ brand: { title: "Demo Fixture" } });
    expect("hook" in report).toBe(false);
  });
});
