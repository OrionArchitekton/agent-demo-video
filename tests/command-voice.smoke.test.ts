import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

const fx = (n: string) => resolve("tests/fixtures/voice", n);

async function render(command: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "cmdvoice-"));
  const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
  const scriptPath = join(dir, "demo.md");
  await writeFile(scriptPath, (await readFile(resolve("tests/fixtures/demo.md"), "utf8")).replaceAll("FIXTURE_URL", fixture));
  const cfg = DemoConfigSchema.parse({
    script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"),
    resolution: { width: 1280, height: 720 }, voice: { provider: "command", command, timeoutSec: 60 },
  });
  const r = await runPipeline(cfg, { requireFreshOut: true });
  const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
  return { r, report };
}

describe("runPipeline with a command voice (smoke, no hosted key)", { timeout: 180_000 }, () => {
  // Vitest reuses a worker across files, so restore what each test removes.
  let prevFakeTts: string | undefined;
  let prevKey: string | undefined;
  beforeEach(() => {
    prevFakeTts = process.env.FAKE_TTS;
    prevKey = process.env.ELEVENLABS_API_KEY;
    delete process.env.FAKE_TTS;
    delete process.env.ELEVENLABS_API_KEY;
  });
  afterEach(() => {
    if (prevFakeTts === undefined) delete process.env.FAKE_TTS; else process.env.FAKE_TTS = prevFakeTts;
    if (prevKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prevKey;
  });

  it("AC2: renders with estimated timing when the voice writes no timings", async () => {
    const warn = vi.spyOn(console, "warn");
    let r, report;
    try {
      ({ r, report } = await render([fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"]));
      expect(warn.mock.calls.some((c) => /estimated caption timing/.test(String(c[0])))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    expect(r.report.parity.ok).toBe(true);
    expect(report.ttsMode).toBe("real");
    expect(report.voice).toEqual({ provider: "command", command: "tone.sh", timeoutSec: 60 });
    expect(report.narration.every((n: { timing: string }) => n.timing === "estimated")).toBe(true);
  });

  it("AC3: reports provider timing when the voice writes word timings", async () => {
    const { report } = await render([fx("tone-words.sh"), "--text-file", "{text}", "--out", "{out}"]);
    expect(report.narration.every((n: { timing: string }) => n.timing === "provider")).toBe(true);
  });
});
