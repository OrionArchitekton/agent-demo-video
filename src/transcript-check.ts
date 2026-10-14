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

/** Phrases fewer than `minHeard` of whose words were matched, in order, in the heard words. */
export function droppedPhrases(phrases: string[], heardWords: string[], minHeard = MIN_HEARD): string[] {
  const { tokens, matched } = matchScriptTokens(phrases.join(" "), heardWords.map((word) => ({ word })), { preferSkip: true });
  const out: string[] = [];
  let offset = 0, ti = 0;
  for (const phrase of phrases) {
    const from = offset, to = offset + phrase.length;
    offset = to + 1;
    let hit = 0, countable = 0;
    while (ti < tokens.length && tokens[ti]!.index < to) {
      if (tokens[ti]!.index >= from && key(tokens[ti]!.word)) { countable++; if (matched[ti]) hit++; }
      ti++;
    }
    if (countable > 0 && hit / countable < minHeard) out.push(phrase);
  }
  return out;
}

export type TranscriptCheck =
  | { ran: true; droppedPhrases: string[] }
  | { ran: false; reason: string };

/** Run the configured aligner once over the finished video; never throws (advisory). */
export async function runTranscriptCheck(
  videoPath: string, narrations: string[], aligner: string[] | undefined, timeoutSec: number, workDir: string,
): Promise<TranscriptCheck> {
  if (!aligner) return { ran: false, reason: "no voice.aligner configured" };
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
