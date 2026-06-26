import { describe, it, expect } from "vitest";
import { buildTimeline, padToMax } from "./timeline";

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
