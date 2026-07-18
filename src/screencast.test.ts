import { describe, it, expect } from "vitest";
import { frameDurations, framesConcatContent, MIN_FRAME_SEC } from "./screencast";

describe("frameDurations", () => {
  it("derives per-frame durations from timestamps, last frame running to stopTs", () => {
    expect(frameDurations([10, 10.1, 10.5], 11)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.4, 6),
      expect.closeTo(0.5, 6),
    ]);
  });

  it("clamps non-monotonic or zero gaps to MIN_FRAME_SEC instead of emitting <=0 durations", () => {
    const d = frameDurations([10, 10, 9.9], 9);
    expect(d).toHaveLength(3);
    for (const v of d) expect(v).toBeGreaterThanOrEqual(MIN_FRAME_SEC);
  });

  it("returns [] for no frames", () => {
    expect(frameDurations([], 5)).toEqual([]);
  });
});

describe("framesConcatContent", () => {
  it("emits concat-demuxer lines with durations and repeats the last file so its duration binds", () => {
    const out = framesConcatContent(["/a/f1.jpg", "/a/f2.jpg"], [0.1, 0.25]);
    expect(out).toBe(
      [
        "file '/a/f1.jpg'",
        "duration 0.100000",
        "file '/a/f2.jpg'",
        "duration 0.250000",
        "file '/a/f2.jpg'",
      ].join("\n"),
    );
  });

  it("escapes single quotes in paths like the segment concat list does", () => {
    const out = framesConcatContent(["/a/it's.jpg"], [0.2]);
    expect(out).toContain("file '/a/it'\\''s.jpg'");
  });

  it("throws on file/duration length mismatch and on empty input", () => {
    expect(() => framesConcatContent(["/a"], [])).toThrow(/mismatch/i);
    expect(() => framesConcatContent([], [])).toThrow(/no frames/i);
  });
});

describe("cursorMode", () => {
  it("routes to exactly one cursor path: native under screencast+annotations, overlay otherwise per theme.cursor", async () => {
    const { cursorMode } = await import("./screencast");
    expect(cursorMode("screencast", true, true)).toBe("native");
    expect(cursorMode("screencast", true, false)).toBe("native");
    expect(cursorMode("screencast", false, true)).toBe("overlay");
    expect(cursorMode("recordvideo", true, true)).toBe("overlay");
    expect(cursorMode("recordvideo", true, false)).toBe("none");
    expect(cursorMode("screencast", false, false)).toBe("none");
  });
});
