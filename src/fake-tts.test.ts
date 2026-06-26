import { describe, it, expect } from "vitest";
import { estimateDurationSec, synthAlignment } from "./fake-tts";

describe("fake-tts", () => {
  it("estimates duration from word count with a floor", () => {
    expect(estimateDurationSec("one two three four five")).toBeCloseTo(5 * 0.38, 2);
    expect(estimateDurationSec("hi")).toBeGreaterThanOrEqual(1.0);
  });
  it("synthesizes char-level alignment spanning the duration", () => {
    const a = synthAlignment("abc", 3);
    expect(a.chars).toEqual(["a", "b", "c"]);
    expect(a.startSec[0]).toBe(0);
    expect(a.endSec[2]).toBeCloseTo(3, 5);
    expect(a.endSec.every((e, i) => e > a.startSec[i]!)).toBe(true);
  });
});
