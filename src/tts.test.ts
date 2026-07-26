import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { synthShot, resolveTtsMode } from "./tts";
import { DemoConfigSchema } from "./types";

describe("resolveTtsMode", () => {
  it("refuses to render silently when the key is absent and fake mode was not requested", () => {
    expect(() => resolveTtsMode({ FAKE_TTS: undefined, ELEVENLABS_API_KEY: undefined }))
      .toThrowError(/ELEVENLABS_API_KEY/);
  });
});

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

describe("resolveTtsMode precedence", () => {
  it("selects fake only when explicitly requested, and that request wins over a present key", () => {
    expect(resolveTtsMode({ FAKE_TTS: "1" })).toBe("fake");
    expect(resolveTtsMode({ FAKE_TTS: "1", ELEVENLABS_API_KEY: "k" })).toBe("fake");
  });
  it("selects real when a key is present and fake was not requested", () => {
    expect(resolveTtsMode({ ELEVENLABS_API_KEY: "k" })).toBe("real");
  });
  it("does not treat any other FAKE_TTS value as a request for silence", () => {
    expect(() => resolveTtsMode({ FAKE_TTS: "true" })).toThrowError(/ELEVENLABS_API_KEY/);
    expect(() => resolveTtsMode({ FAKE_TTS: "0" })).toThrowError(/ELEVENLABS_API_KEY/);
  });
});
