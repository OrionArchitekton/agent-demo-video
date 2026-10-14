import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { matchScriptTokens } from "./word-timing";
import { runCommand, readWordsFile } from "./command-voice";

/**
 * Transcript check (specs/render-quality-checks-spec.md S1): did the finished video SAY the script?
 * Recognized words are matched to the narration words IN ORDER with the caption-timing
 * matcher, so "A.I." matches "AI" and "log in" matches "login". Advisory: recognizers mishear names and spelled numbers.
 */
export const MIN_HEARD = 0.7;

const key = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Narration texts -> sentence-level phrases. */
export function splitPhrases(narrations: string[]): string[] {
  return narrations.flatMap((n) => n.split(/(?<=[.!?])\s+/)).map((p) => p.trim()).filter(Boolean);
}

/**
 * Phrases fewer than `minHeard` of whose words were matched, in order, in the heard words.
 * When a later phrase repeats an earlier one's words, equally good alignments can hand the
 * heard words to either phrase. A phrase is reported only when it is dropped under BOTH
 * tie-break directions, so a heard phrase is never blamed for a neighbour's omission.
 */
export function droppedPhrases(phrases: string[], heardWords: string[], minHeard = MIN_HEARD): string[] {
  const heard = heardWords.map((word) => ({ word }));
  const skipFirst = droppedUnder(phrases, heard, minHeard, true);
  const matchFirst = droppedUnder(phrases, heard, minHeard, false);
  return phrases.filter((_, i) => skipFirst[i] && matchFirst[i]);
}

/** Per phrase: dropped under one tie-break direction of the in-order matching. */
function droppedUnder(phrases: string[], heard: { word: string }[], minHeard: number, preferSkip: boolean): boolean[] {
  const { tokens, matched } = matchScriptTokens(phrases.join(" "), heard, { preferSkip });
  const out: boolean[] = [];
  let offset = 0, ti = 0;
  for (const phrase of phrases) {
    const from = offset, to = offset + phrase.length;
    offset = to + 1;
    let hit = 0, countable = 0;
    while (ti < tokens.length && tokens[ti]!.index < to) {
      if (tokens[ti]!.index >= from && key(tokens[ti]!.word)) { countable++; if (matched[ti]) hit++; }
      ti++;
    }
    out.push(countable > 0 && hit / countable < minHeard);
  }
  return out;
}

export type TranscriptCheck =
  | { ran: true; droppedPhrases: string[] }
  | { ran: false; reason: string };

/**
 * Run the configured aligner once over the finished video; never throws (advisory).
 * A FAKE_TTS dry run has silent narration, so the aligner is not run at all.
 */
export async function runTranscriptCheck(
  videoPath: string, narrations: string[], aligner: string[] | undefined, timeoutSec: number, workDir: string,
  opts: { fakeTts?: boolean } = {},
): Promise<TranscriptCheck> {
  if (!aligner) return { ran: false, reason: "no voice.aligner configured" };
  if (opts.fakeTts) return { ran: false, reason: "FAKE_TTS: narration is silent" };
  try {
    await mkdir(workDir, { recursive: true });
    const textPath = join(workDir, "transcript-check.txt");
    const outPath = join(workDir, "transcript-check.words.json");
    await writeFile(textPath, narrations.join(" "), "utf8");
    await rm(outPath, { force: true }); // never read a previous run's timings
    await runCommand("transcript check", aligner, { audio: videoPath, text: textPath, out: outPath }, timeoutSec);
    const words = await readWordsFile(outPath, "transcript check");
    if (!words) return { ran: false, reason: "aligner wrote no word timings" };
    // droppedPhrases can throw on very long scripts (alignment size cap); it stays inside the try.
    return { ran: true, droppedPhrases: droppedPhrases(splitPhrases(narrations), words.map((w) => w.word)) };
  } catch (e) {
    return { ran: false, reason: `aligner failed: ${(e as Error).message}` };
  }
}
