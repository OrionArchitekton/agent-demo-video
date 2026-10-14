import { describe, it, expect } from "vitest";
import { splitPhrases, droppedPhrases } from "./transcript-check";

describe("splitPhrases", () => {
  it("splits narration into sentences and trims", () => {
    expect(splitPhrases(["First line. Second one!", "Third?  "])).toEqual(["First line.", "Second one!", "Third?"]);
  });
});

const w = (t: string) => t.split(/\s+/).filter(Boolean);

describe("droppedPhrases", () => {
  it("treats spelling variants as heard", () => {
    const phrases = ["I use A.I. assistants.", "Today's is from Work Cue."];
    expect(droppedPhrases(phrases, w("i use ai assistants todays is from workcue"))).toEqual([]);
  });
  it("flags a phrase the render never said", () => {
    const phrases = ["Paste only what the task needs.", "Then diff the result."];
    expect(droppedPhrases(phrases, w("paste only what the task needs and that is all"))).toEqual(["Then diff the result."]);
  });
  it("tolerates a single misheard word", () => {
    expect(droppedPhrases(["Keep a human on every commitment."], w("keep a human on every commitments"))).toEqual([]);
  });
  it("never flags a phrase with no letters or digits", () => {
    expect(droppedPhrases(["...", "?!"], [])).toEqual([]);
  });
  it("flags a common-word sentence dropped from a long transcript", () => {
    const base = [
      "This is the first shot of the smoke test.",
      "Then we run the render and watch the results.",
      "The demo shows the whole pipeline running end to end.",
    ];
    const rep = (n: number) => Array.from({ length: n }, () => base).flat();
    const heard = w(rep(27).join(" "));
    expect(heard.length).toBeGreaterThan(700);
    const missing = "And this is the second shot.";
    const phrases = [...rep(13), missing, ...rep(14)];
    expect(droppedPhrases(phrases, heard)).toEqual([missing]);
  });
});
