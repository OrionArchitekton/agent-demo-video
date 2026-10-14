import { describe, it, expect } from "vitest";
import { splitPhrases, droppedPhrases } from "./transcript-check";

describe("splitPhrases", () => {
  it("splits narration into sentences and trims", () => {
    expect(splitPhrases(["First line. Second one!", "Third?  "])).toEqual(["First line.", "Second one!", "Third?"]);
  });
});

describe("droppedPhrases", () => {
  it("treats spelling variants as heard", () => {
    const phrases = ["I use A.I. assistants.", "Today's is from Work Cue."];
    expect(droppedPhrases(phrases, "i use ai assistants todays is from workcue")).toEqual([]);
  });
  it("flags a phrase the render never said", () => {
    const phrases = ["Paste only what the task needs.", "Then diff the result."];
    expect(droppedPhrases(phrases, "paste only what the task needs and that is all")).toEqual(["Then diff the result."]);
  });
  it("tolerates small recognition differences", () => {
    expect(droppedPhrases(["Keep a human on every commitment."], "keep a human on every commitments")).toEqual([]);
  });
  it("never flags a phrase with no letters or digits", () => {
    expect(droppedPhrases(["...", "?!"], "")).toEqual([]);
  });
});
