import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { synthShot } from "./tts";
import { DemoConfigSchema } from "./types";

describe("synthShot (FAKE_TTS)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("writes a silent mp3 and returns duration+alignment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tts-"));
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x" });
    const r = await synthShot({ id: "s1", target: "dashboard", narration: "hello world demo", actions: [] }, cfg, dir);
    expect(r.durationSec).toBeGreaterThan(0);
    expect(r.alignment.chars.length).toBeGreaterThan(0);
    expect((await stat(r.audioPath)).size).toBeGreaterThan(0);
  });
});
