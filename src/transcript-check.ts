import { matchScriptTokens } from "./word-timing";

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
