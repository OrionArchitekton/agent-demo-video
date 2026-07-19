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

describe("word-pop captions (S3)", () => {
  const align = (text: string, startSec = 0, perChar = 0.1) => {
    const chars = text.split("");
    return {
      chars,
      startSec: chars.map((_, i) => startSec + i * perChar),
      endSec: chars.map((_, i) => startSec + (i + 1) * perChar),
    };
  };

  it("emits one accumulating Dialogue event per word with the active word accented", async () => {
    const { toWordAss } = await import("./captions");
    const ass = toWordAss([{ alignment: align("hello brave world"), startSec: 0 }], {
      width: 1920, height: 1080, font: "Arial", fontSize: 46, accent: "#3fb950", marginV: 96,
    });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(3);
    expect(events[1]).toContain("hello");
    expect(events[1]).toMatch(/\\c&H[0-9A-F]+&.*brave/i);
  });

  it("offsets event times by the shot's startSec and escapes ASS braces", async () => {
    const { toWordAss } = await import("./captions");
    const ass = toWordAss([{ alignment: align("a{b}"), startSec: 60 }], {
      width: 1280, height: 720, font: "Arial", fontSize: 40, accent: "#ff0000", marginV: 80,
    });
    const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(ev[0]).toContain("0:01:00.00");
    expect(ass).not.toMatch(/[^\\]\{b/);
  });

  it("starts a fresh caption line when a line would exceed the word budget", async () => {
    const { toWordAss } = await import("./captions");
    const text = "one two three four five six seven eight nine ten";
    const ass = toWordAss([{ alignment: align(text), startSec: 0 }], {
      width: 1920, height: 1080, font: "Arial", fontSize: 46, accent: "#3fb950", marginV: 96, maxWordsPerLine: 4,
    });
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(10);
    expect(events[4]).not.toContain("one");
  });
});
