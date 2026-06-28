import { describe, it, expect } from "vitest";
import { buildTimeline, padToMax, reconcileSegmentDuration } from "./timeline";

describe("timeline", () => {
  it("computes cumulative offsets", () => {
    const t = buildTimeline([{ shotId: "a", durationSec: 2 }, { shotId: "b", durationSec: 3 }]);
    expect(t.entries.map(e => e.startSec)).toEqual([0, 2]);
    expect(t.totalSec).toBe(5);
  });
  it("padToMax returns the larger of audio vs action", () => {
    expect(padToMax(2, 3.5)).toBe(3.5);
    expect(padToMax(4, 1)).toBe(4);
  });
});

describe("reconcileSegmentDuration", () => {
  it("extends the segment to the narration when the clip is shorter (prebaked too short)", () => {
    // A prebaked clip of 2s under a 7.6s narration would otherwise truncate the
    // voiceover; the authoritative duration must become the narration length and
    // the deficit reports how much video to add (freeze last frame).
    const r = reconcileSegmentDuration(2, 7.6);
    expect(r.durationSec).toBeCloseTo(7.6, 6);
    expect(r.extendBySec).toBeCloseTo(5.6, 6);
  });
  it("is a no-op when the clip already covers the narration (live capture dwells)", () => {
    const r = reconcileSegmentDuration(9, 7.6);
    expect(r.durationSec).toBe(9);
    expect(r.extendBySec).toBe(0);
  });
  it("never returns a negative deficit when durations are equal", () => {
    const r = reconcileSegmentDuration(5, 5);
    expect(r.durationSec).toBe(5);
    expect(r.extendBySec).toBe(0);
  });
});
