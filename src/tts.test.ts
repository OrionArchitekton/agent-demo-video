import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
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

describe("resolveTtsMode with the command provider", () => {
  it("needs no hosted key for a command voice", () => {
    expect(resolveTtsMode({}, "command")).toBe("real");
  });
  it("still honours an explicit fake request", () => {
    expect(resolveTtsMode({ FAKE_TTS: "1" }, "command")).toBe("fake");
  });
  it("still requires the hosted key for the default provider", () => {
    expect(() => resolveTtsMode({}, "elevenlabs")).toThrowError(/ELEVENLABS_API_KEY/);
  });
});

describe("synthShot with a command voice", () => {
  const shot = { id: "s1", target: "dashboard" as const, narration: "Paste only what the task needs.", actions: [] };
  const fx = (n: string) => resolve("tests/fixtures/voice", n);
  const cfgWith = (voice: Record<string, unknown>) =>
    DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", voice: { provider: "command", timeoutSec: 30, ...voice } });
  const run = async (voice: Record<string, unknown>) =>
    synthShot(shot, cfgWith(voice), await mkdtemp(join(tmpdir(), "cmdtts-")));
  beforeEach(() => { delete process.env.FAKE_TTS; });

  it("uses the command's audio and estimates timing when no words and no aligner", async () => {
    const r = await run({ command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"] });
    expect(r.timing).toBe("estimated");
    expect(r.durationSec).toBeGreaterThan(1.4);
    expect(r.alignment.chars.join("")).toBe(shot.narration);
  });
  it("uses the command's own word timings when it writes them", async () => {
    const r = await run({ command: [fx("tone-words.sh"), "--text-file", "{text}", "--out", "{out}"] });
    expect(r.timing).toBe("provider");
    expect(r.alignment.startSec[0]).toBe(0);
    expect(r.alignment.chars.join("")).toBe("Paste only what the task needs.");
    expect(r.alignment.startSec[6]).toBeCloseTo(0.25, 3);
    expect(r.alignment.startSec["Paste only what the task ".length]).toBeCloseTo(1.25, 3);
  });
  it("treats an empty word timings list from the command as no timings (estimate)", async () => {
    const r = await run({ command: [fx("tone-empty-words.sh"), "--text-file", "{text}", "--out", "{out}"] });
    expect(r.timing).toBe("estimated");
  });
  it("treats an empty word timings list from the command as no timings (aligner)", async () => {
    const r = await run({
      command: [fx("tone-empty-words.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-even.sh"), "{audio}", "{text}", "{out}"],
    });
    expect(r.timing).toBe("aligned");
  });
  it("runs the aligner when the command writes no timings", async () => {
    const r = await run({
      command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-even.sh"), "{audio}", "{text}", "{out}"],
    });
    expect(r.timing).toBe("aligned");
  });
  it("stops on audio shorter than 0.3 s", async () => {
    await expect(run({ command: [fx("short.sh"), "--text-file", "{text}", "--out", "{out}"] }))
      .rejects.toThrowError(/voice command \(shot s1\): audio is 0\.1\d*s/);
  });
  it("stops when a configured aligner fails, never falling back silently", async () => {
    await expect(run({ command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"], aligner: [fx("fail.sh"), "{audio}", "{text}", "{out}"] }))
      .rejects.toThrowError(/aligner \(shot s1\): exited 3/);
  });
  it("stops when timings match under 60% of the script's words", async () => {
    await expect(run({
      command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-wrong.sh"), "{audio}", "{text}", "{out}"],
    })).rejects.toThrowError(/aligner \(shot s1\): word timings match only \d+% of the script's words/);
  });
  it("stops when the voice command's word timings run past the audio", async () => {
    await expect(run({ command: [fx("tone-words-long.sh"), "--text-file", "{text}", "--out", "{out}"] }))
      .rejects.toThrowError(/^voice command \(shot s1\): word timings run to 30s but the audio is 1\.\d+s/);
  });
  it("stops when the aligner's word timings run past the audio", async () => {
    await expect(run({
      command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-long.sh"), "{audio}", "{text}", "{out}"],
    })).rejects.toThrowError(/^aligner \(shot s1\): word timings run to 30s but the audio is 1\.\d+s/);
  });
  it("stops, naming the voice command, when its own non-empty timings cover under 60% even with an aligner configured", async () => {
    await expect(run({
      command: [fx("tone-words-wrong.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-even.sh"), "{audio}", "{text}", "{out}"],
    })).rejects.toThrowError(/^voice command \(shot s1\): word timings match only \d+% of the script's words/);
  });
  it("labels unreadable audio with its shot", async () => {
    await expect(run({ command: [fx("empty.sh"), "--text-file", "{text}", "--out", "{out}"] }))
      .rejects.toThrowError(/voice command \(shot s1\): cannot read audio/);
  });
});
