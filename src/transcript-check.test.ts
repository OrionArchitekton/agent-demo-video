import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { splitPhrases, droppedPhrases, runTranscriptCheck } from "./transcript-check";

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

describe("runTranscriptCheck", () => {
  const fx = (n: string) => resolve("tests/fixtures/voice", n);
  it("stays advisory: no aligner configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tcheck-"));
    expect(await runTranscriptCheck("v.mp4", ["Hello there."], undefined, 30, dir)).toEqual({ ran: false, reason: "no voice.aligner configured" });
  });
  it("stays advisory: a script too long to align reports ran:false instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tcheck-"));
    const huge = Array.from({ length: 6000 }, (_, i) => `word${i}`).join(" ") + ".";
    const r = await runTranscriptCheck("v.mp4", [huge], [fx("align-hear-all.sh"), "{audio}", "{text}", "{out}"], 60, dir);
    expect(r.ran).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining("too large to align") });
  });
  it("ignores a stale words file left by a previous run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tcheck-"));
    await mkdir(dir, { recursive: true });
    const words = "Hello there.".split(" ").map((word, i) => ({ word, start: i * 0.2, end: i * 0.2 + 0.2 }));
    await writeFile(join(dir, "transcript-check.words.json"), JSON.stringify(words));
    const r = await runTranscriptCheck("v.mp4", ["Hello there."], [fx("align-silent.sh"), "{audio}", "{text}", "{out}"], 30, dir);
    expect(r).toEqual({ ran: false, reason: "aligner wrote no word timings" });
  });
});
