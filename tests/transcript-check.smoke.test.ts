import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

const fx = (n: string) => resolve("tests/fixtures/voice", n);

async function render(voice: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "tcheck-"));
  const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
  const scriptPath = join(dir, "demo.md");
  await writeFile(scriptPath, (await readFile(resolve("tests/fixtures/demo.md"), "utf8")).replaceAll("FIXTURE_URL", fixture));
  const cfg = DemoConfigSchema.parse({
    script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"),
    resolution: { width: 1280, height: 720 }, voice,
  });
  await runPipeline(cfg, { requireFreshOut: true });
  return JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
}

const commandVoice = (aligner: string) => ({
  provider: "command",
  command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"],
  aligner: [fx(aligner), "{audio}", "{text}", "{out}"],
  timeoutSec: 60,
});

describe("transcript check in the pipeline (smoke)", { timeout: 180_000 }, () => {
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

  it("AC1a: records a clean check when the video says the whole script", async () => {
    const report = await render(commandVoice("align-hear-all.sh"));
    expect(report.transcriptCheck).toEqual({ ran: true, droppedPhrases: [] });
  });

  it("AC1b: names the dropped phrase and warns", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      const report = await render(commandVoice("align-drop-second.sh"));
      expect(report.transcriptCheck.ran).toBe(true);
      expect(report.transcriptCheck.droppedPhrases).toEqual(["And this is the second shot."]);
      expect(warn.mock.calls.some((c) => /transcript check: 1 narration phrase/.test(String(c[0])))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("AC1c/AC5: without an aligner the report says the check did not run", async () => {
    process.env.FAKE_TTS = "1";
    const report = await render({});
    expect(report.transcriptCheck).toEqual({ ran: false, reason: "no voice.aligner configured" });
  });
});
