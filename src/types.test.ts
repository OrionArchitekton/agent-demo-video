import { describe, it, expect } from "vitest";
import { ManifestSchema, DemoConfigSchema } from "./types";

describe("schemas", () => {
  it("parses a minimal manifest", () => {
    const m = { shots: [{ id: "s1", target: "dashboard", narration: "Hello.", actions: [{ kind: "goto", url: "/" }] }] };
    expect(ManifestSchema.parse(m).shots.length).toBe(1);
  });
  it("rejects an unknown action kind", () => {
    expect(() => ManifestSchema.parse({ shots: [{ id: "s1", target: "dashboard", narration: "x", actions: [{ kind: "bogus" }] }] })).toThrow();
  });
  it("parses a config with defaults applied", () => {
    const c = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000" });
    expect(c.fps).toBe(30); expect(c.resolution.width).toBe(1920);
    expect(c.captureCss).toBeUndefined();
  });
  it("parses optional captureCss when provided", () => {
    const c = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000", captureCss: ".feed{max-height:200px}" });
    expect(c.captureCss).toBe(".feed{max-height:200px}");
  });
  it("accepts the live target on a shot (additive enum)", () => {
    const m = { shots: [{ id: "s1", target: "live", narration: "x", actions: [{ kind: "goto", url: "/" }] }] };
    expect(ManifestSchema.parse(m).shots[0]!.target).toBe("live");
  });
  it("defaults capture so old configs still validate (screencast engine), and accepts an optional capture.auth", () => {
    const old = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://x" });
    expect(old.capture).toEqual({ engine: "screencast", screencastQuality: 90, settleMs: 500 });
    expect(old.capture.auth).toBeUndefined();
    const withAuth = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://x", capture: { auth: { loginUrl: "https://app/login" } } });
    expect(withAuth.capture.auth?.loginUrl).toBe("https://app/login");
    expect(withAuth.capture.auth?.confirmMode).toBe("operator");
    expect(withAuth.capture.auth?.loginTimeoutMs).toBe(120000);
  });
});

describe("hardening", () => {
  it("rejects shot ids containing path separators or parent refs", () => {
    const bad = { shots: [{ id: "../evil", target: "dashboard", narration: "x", actions: [] }] };
    expect(() => ManifestSchema.parse(bad)).toThrow();
    const alsoBad = { shots: [{ id: "a/b", target: "dashboard", narration: "x", actions: [] }] };
    expect(() => ManifestSchema.parse(alsoBad)).toThrow();
  });
  it("rejects duplicate shot ids (silent artifact overwrite)", () => {
    const dup = { shots: [
      { id: "s1", target: "dashboard", narration: "x", actions: [] },
      { id: "s1", target: "dashboard", narration: "y", actions: [] },
    ] };
    expect(() => ManifestSchema.parse(dup)).toThrow(/duplicate/i);
  });
  it("rejects negative zoom phase durations", () => {
    expect(() => DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", motion: { zoomInMs: -1 } })).toThrow();
  });
});

describe("narration quality tier (S6)", () => {
  it("defaults the TTS model to the ElevenLabs quality tier, not flash", () => {
    const c = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x" });
    expect(c.voice.modelId).toBe("eleven_multilingual_v2");
  });
  it("keeps flash selectable via explicit config", () => {
    const c = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", voice: { modelId: "eleven_flash_v2_5" } });
    expect(c.voice.modelId).toBe("eleven_flash_v2_5");
  });
});

describe("filtergraph boundary validation (review fix)", () => {
  it("rejects malformed colors and filtergraph metacharacters in fonts", () => {
    expect(() => DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", theme: { captionAccent: "red" } })).toThrow();
    expect(() => DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", theme: { captionFont: "Arial:evil='p" } })).toThrow();
  });
  it("rejects reserved __ shot ids and sub-1 effective zoom", () => {
    expect(() => ManifestSchema.parse({ shots: [{ id: "__card-title", target: "dashboard", narration: "x", actions: [] }] })).toThrow(/reserved/);
    expect(() => DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", motion: { baseZoom: 1.0, driftAmp: 0.05 } })).toThrow();
  });
});

describe("voice provider config (specs/command-tts-provider-spec.md)", () => {
  const base = { script: "x", dashboardBaseUrl: "http://x" };
  it("defaults to the hosted provider with no command", () => {
    const c = DemoConfigSchema.parse(base);
    expect(c.voice.provider).toBeUndefined();
    expect(c.voice.command).toBeUndefined();
    expect(c.voice.timeoutSec).toBeUndefined();
    const keys = Object.keys(JSON.parse(JSON.stringify(DemoConfigSchema.parse(base).voice)));
    expect(keys).not.toContain("provider");
    expect(keys).not.toContain("timeoutSec");
  });
  it("requires voice.command for the command provider", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { provider: "command" } })).toThrowError(/voice\.command/);
  });
  it("requires {text} and {out} placeholders in the command", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { provider: "command", command: ["tts", "{text}"] } }))
      .toThrowError(/\{out\}/);
  });
  it("requires {audio}, {text} and {out} placeholders in the aligner", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { provider: "command", command: ["tts", "{text}", "{out}"], aligner: ["al", "{audio}", "{out}"] } }))
      .toThrowError(/\{text\}/);
  });
  it("rejects voice.command without the command provider", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { command: ["tts", "{text}", "{out}"] } }))
      .toThrowError(/only used with voice\.provider \\+"command/);
  });
  it("rejects voice.aligner without the command provider", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { aligner: ["al", "{audio}", "{text}", "{out}"] } }))
      .toThrowError(/only used with voice\.provider \\+"command/);
  });
  it("caps voice.timeoutSec at the Node timer limit", () => {
    const voice = (timeoutSec: number) => ({ ...base, voice: { provider: "command", command: ["tts", "{text}", "{out}"], timeoutSec } });
    expect(DemoConfigSchema.parse(voice(2147483)).voice.timeoutSec).toBe(2147483);
    expect(() => DemoConfigSchema.parse(voice(2147484))).toThrowError(/timeoutSec/);
  });
  it("accepts a command voice with an aligner", () => {
    const c = DemoConfigSchema.parse({ ...base, voice: { provider: "command", command: ["tts", "--text-file", "{text}", "--out", "{out}"], aligner: ["python3", "tools/align_whisper.py", "{audio}", "{text}", "{out}"], timeoutSec: 120 } });
    expect(c.voice.command).toEqual(["tts", "--text-file", "{text}", "--out", "{out}"]);
    expect(c.voice.timeoutSec).toBe(120);
  });
});

describe("brand.hook", () => {
  const base = { script: "x", dashboardBaseUrl: "http://x" };
  it("accepts a hook up to 60 characters", () => {
    expect(DemoConfigSchema.parse({ ...base, brand: { title: "T", hook: "Stop pasting secrets into AI" } }).brand?.hook).toBe("Stop pasting secrets into AI");
  });
  it("rejects a whitespace-only hook", () => {
    expect(() => DemoConfigSchema.parse({ ...base, brand: { title: "T", hook: "   " } })).toThrow();
  });
  it("rejects a hook over 60 characters", () => {
    expect(() => DemoConfigSchema.parse({ ...base, brand: { title: "T", hook: "x".repeat(61) } })).toThrowError(/60/);
  });
});
