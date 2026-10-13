import { describe, it, expect } from "vitest";
import { alignScriptWords, MIN_COVERAGE } from "./word-timing";

describe("alignScriptWords", () => {
  it("keeps the script's spelling and uses the recognizer only for times", () => {
    const { alignment, coverage } = alignScriptWords("Use A.I. today", [
      { word: "use", start: 0, end: 0.3 }, { word: "AI", start: 0.35, end: 0.7 }, { word: "today.", start: 0.75, end: 1.2 },
    ], 1.5);
    expect(alignment.chars.join("")).toBe("Use A.I. today");
    expect(coverage).toBe(1);
    expect(alignment.startSec[4]).toBe(0.35); // the "A" of "A.I."
  });
  it("interpolates a word the timings missed between its neighbours", () => {
    const { alignment, coverage } = alignScriptWords("one two three", [
      { word: "one", start: 0, end: 0.4 }, { word: "three", start: 1.0, end: 1.4 },
    ], 1.5);
    expect(coverage).toBeCloseTo(2 / 3);
    const twoStart = alignment.startSec["one ".length]!;
    expect(twoStart).toBeGreaterThanOrEqual(0.4);
    expect(twoStart).toBeLessThan(1.0);
  });
  it("produces one non-decreasing time per character", () => {
    const text = "Paste only what the task needs.";
    const { alignment } = alignScriptWords(text, [
      { word: "paste", start: 0, end: 0.3 }, { word: "only", start: 0.3, end: 0.5 },
      { word: "what", start: 0.5, end: 0.7 }, { word: "the", start: 0.7, end: 0.8 },
      { word: "task", start: 0.8, end: 1.0 }, { word: "needs", start: 1.0, end: 1.3 },
    ], 1.4);
    expect(alignment.chars.length).toBe(text.length);
    for (let i = 1; i < text.length; i++) expect(alignment.startSec[i]!).toBeGreaterThanOrEqual(alignment.startSec[i - 1]!);
  });
  it("reports low coverage so the caller can refuse a wrong take", () => {
    const { coverage } = alignScriptWords("alpha beta gamma delta", [{ word: "zzz", start: 0, end: 1 }], 2);
    expect(coverage).toBeLessThan(MIN_COVERAGE);
  });
  const seq = (ws: string[], step = 0.3) => ws.map((word, i) => ({ word, start: i * step, end: i * step + step }));
  const tokenSpan = (text: string, alignment: { startSec: number[]; endSec: number[] }, word: string) => {
    const at = text.indexOf(word);
    return { start: alignment.startSec[at]!, end: alignment.endSec[at + word.length - 1]! };
  };
  const monotone = (a: number[]) => { for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThanOrEqual(a[i - 1]!); };

  it("resyncs after a spoken-form number", () => {
    const text = "we hit 4.2M users and growing fast today";
    const { alignment, coverage } = alignScriptWords(text, seq(["we", "hit", "four", "point", "two", "million", "users", "and", "growing", "fast", "today"]), 3.6);
    expect(coverage).toBeGreaterThanOrEqual(7 / 8);
    expect(alignment.startSec[text.indexOf("users")]).toBeCloseTo(6 * 0.3, 6);
  });
  it("joins split words", () => {
    const text = "a state-of-the-art tool that ships fast";
    const timed = seq(["a", "state", "of", "the", "art", "tool", "that", "ships", "fast"]);
    const { alignment, coverage } = alignScriptWords(text, timed, 2.7);
    expect(coverage).toBe(1);
    const span = tokenSpan(text, alignment, "state-of-the-art");
    expect(span.start).toBeCloseTo(timed[1]!.start, 6);
    expect(span.end).toBeCloseTo(timed[4]!.end, 6);
  });
  it("repeated words do not skip", () => {
    const text = "the cat the dog";
    const timed = [{ word: "cat", start: 0, end: 0.3 }, { word: "the", start: 0.3, end: 0.5 }, { word: "dog", start: 0.5, end: 0.8 }];
    const { alignment, coverage } = alignScriptWords(text, timed, 1);
    expect(coverage).toBe(0.75);
    expect(alignment.startSec[text.lastIndexOf("the")]).toBeCloseTo(0.3, 6);
  });
  it("monotone even with overlapping timings", () => {
    const text = "a b c d";
    const { alignment } = alignScriptWords(text, [
      { word: "a", start: 0, end: 1.0 }, { word: "b", start: 0.9, end: 1.5 },
      { word: "zz", start: 0.95, end: 1.2 }, { word: "d", start: 0.9, end: 1.6 },
    ], 2);
    monotone(alignment.startSec);
    monotone(alignment.endSec);
    for (const w of ["a", "b", "c", "d"]) { const s = tokenSpan(text, alignment, w); expect(s.end).toBeGreaterThan(s.start); }
  });
  it("trailing words past the audio collapse onto the audio end, never beyond it", () => {
    const text = "one two three";
    const { alignment } = alignScriptWords(text, [{ word: "one", start: 0, end: 1.6 }], 1.5);
    expect(Math.max(...alignment.startSec, ...alignment.endSec)).toBeLessThanOrEqual(1.5);
    monotone(alignment.startSec);
    monotone(alignment.endSec);
  });
  it("keeps every time within a 1.5 s take when only the first 3 of 5 words were timed", () => {
    const text = "one two three four five";
    const timed = [
      { word: "one", start: 0, end: 0.5 }, { word: "two", start: 0.5, end: 1 }, { word: "three", start: 1, end: 1.5 },
    ];
    const { alignment } = alignScriptWords(text, timed, 1.5);
    expect(Math.max(...alignment.endSec)).toBeLessThanOrEqual(1.5);
    expect(Math.max(...alignment.startSec)).toBeLessThanOrEqual(1.5);
    monotone(alignment.startSec);
    monotone(alignment.endSec);
  });
  it("matches one recognizer word to several script words it merged", () => {
    const text = "Set up in 2 minutes.";
    const timed = [
      { word: "Setup", start: 0.5, end: 0.9 }, { word: "in", start: 0.95, end: 1.1 },
      { word: "two", start: 1.15, end: 1.4 }, { word: "minutes", start: 1.45, end: 1.9 },
    ];
    const { alignment, coverage } = alignScriptWords(text, timed, 2);
    expect(coverage).toBeGreaterThanOrEqual(MIN_COVERAGE);
    const set = tokenSpan(text, alignment, "Set");
    const up = tokenSpan(text, alignment, "up");
    expect(set.start).toBeCloseTo(0.5, 6);
    expect(up.end).toBeCloseTo(0.9, 6);
    // Split by character share: "Set" takes 3 of the 5 letters in "Setup".
    expect(set.end).toBeCloseTo(0.5 + 0.4 * (3 / 5), 6);
    expect(up.start).toBeCloseTo(set.end, 6);
  });
  it("merged words count toward coverage", () => {
    const { coverage } = alignScriptWords("log in now", [{ word: "login", start: 0, end: 0.4 }, { word: "now", start: 0.45, end: 0.7 }], 1);
    expect(coverage).toBe(1);
  });
  it("unicode keys", () => {
    const { coverage } = alignScriptWords("café crème", [{ word: "cafe", start: 0, end: 0.5 }, { word: "creme", start: 0.5, end: 1 }], 1);
    expect(coverage).toBe(1);
  });
});

describe("alignScriptWords cost bound", () => {
  it("refuses an alignment whose table would be too large, before allocating it", () => {
    const text = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" ");
    const timed = Array.from({ length: 3000 }, (_, i) => ({ word: `w${i}`, start: i, end: i + 0.5 }));
    expect(() => alignScriptWords(text, timed, 4000)).toThrowError(/too large to align \(3000 script words x 3000 timed words/);
  });
});
