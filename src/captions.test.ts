import { describe, it, expect } from "vitest";
import { toSrt, captionStyle } from "./captions";
import type { Alignment } from "./types";
const al = (text: string, dur: number): Alignment => {
  const chars = [...text]; const per = dur / chars.length;
  return { chars, startSec: chars.map((_, i) => i * per), endSec: chars.map((_, i) => (i + 1) * per) };
};
describe("toSrt (one cue per shot)", () => {
  it("emits one cue per shot, full narration, offset by shot start", () => {
    const srt = toSrt([{ alignment: al("hi there", 2), startSec: 0 }, { alignment: al("bye", 1), startSec: 2 }]);
    expect(srt).toMatch(/^1\n00:00:00,000 --> 00:00:02,000\n/);
    expect(srt).toContain("hi there");
    expect(srt).toMatch(/\n\n2\n00:00:02,000 --> 00:00:03,000\n/);
    expect(srt.trim().endsWith("bye")).toBe(true);
  });
  it("skips shots with empty alignment", () => {
    const srt = toSrt([{ alignment: { chars: [], startSec: [], endSec: [] }, startSec: 0 }, { alignment: al("ok", 1), startSec: 0 }]);
    expect(srt.trim().startsWith("1\n")).toBe(true);
    expect(srt).toContain("ok");
  });
});

describe("captionStyle", () => {
  it("defaults to a lower-third box band (font, alignment, margin, bg box)", () => {
    const s = captionStyle({ captionFont: "Arial", captionSize: 24 });
    expect(s).toContain("FontName=Arial");
    expect(s).toContain("FontSize=24");
    expect(s).toContain("Alignment=2");
    expect(s).toContain("MarginV=20");
    expect(s).toContain("BorderStyle=3");
    expect(s).toContain("BackColour=");
  });
  it("honours captionMarginV and captionBox=false (plain outline)", () => {
    const s = captionStyle({ captionFont: "Arial", captionSize: 22, captionBox: false, captionMarginV: 40 });
    expect(s).toContain("MarginV=40");
    expect(s).toContain("BorderStyle=1");
    expect(s).not.toContain("BorderStyle=3");
  });
});
