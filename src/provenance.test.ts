import { describe, it, expect } from "vitest";
import { buildRenderReport, digest } from "./provenance";

/**
 * A judged 2:57 cut re-rendered to 3:25 from the SAME script. It was recorded as
 * TTS nondeterminism; it was actually an unpinned voice model default changing
 * under the render. Nothing in the output recorded which voice produced it, so
 * the question "is this video reproducible from the current script?" had no
 * answer. The report is that answer.
 */
describe("buildRenderReport", () => {
  const base = {
    voice: { voiceId: "v1", modelId: "eleven_multilingual_v2", seed: 42, stability: 0.5, similarity: 0.75 },
    ttsMode: "real" as const,
    configHash: "cfg", scriptHash: "scr",
    tools: { ffmpeg: "6.0", ffprobe: "6.0", playwright: "1.61.1", node: "v22" },
    timeline: { entries: [{ shotId: "s1", startSec: 0, durationSec: 3 }], totalSec: 3 },
    render: { totalSec: 3, segments: 1, ticks: 0, parity: { ok: true, problems: [] } },
    maxDurationSec: 300,
  };

  it("records the resolved voice, so two renders can be compared to explain a runtime change", () => {
    const r = buildRenderReport(base);
    expect(r.voice.modelId).toBe("eleven_multilingual_v2");
    expect(r.voice.seed).toBe(42);
    expect(r.ttsMode).toBe("real");
  });

  it("records input digests and the per-shot timeline", () => {
    const r = buildRenderReport(base);
    expect(r.inputs.configHash).toBe("cfg");
    expect(r.inputs.scriptHash).toBe("scr");
    expect(r.timeline.entries[0]?.shotId).toBe("s1");
    expect(r.timeline.totalSec).toBe(3);
  });

  it("digests content stably and distinguishes different content", () => {
    expect(digest("a")).toBe(digest("a"));
    expect(digest("a")).not.toBe(digest("b"));
  });
});
