import { describe, it, expect } from "vitest";
import { toSrt } from "./captions";
import type { Alignment } from "./types";

const al = (text: string, dur: number): Alignment => {
  const chars = [...text]; const per = dur / chars.length;
  return { chars, startSec: chars.map((_, i) => i * per), endSec: chars.map((_, i) => (i + 1) * per) };
};

describe("toSrt", () => {
  it("emits SRT cues grouped into words, offset per shot", () => {
    const srt = toSrt([{ alignment: al("hi there", 2), startSec: 0 }, { alignment: al("bye", 1), startSec: 2 }]);
    expect(srt).toMatch(/^1\n00:00:00,000 --> /);
    expect(srt).toContain("hi there");
    expect(srt).toMatch(/\n\n3\n00:00:02,000 --> /);
    expect(srt.trim().endsWith("bye")).toBe(true);
  });
});
