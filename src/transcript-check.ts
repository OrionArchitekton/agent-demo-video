/**
 * Transcript check (specs/render-quality-checks-spec.md S1): did the finished video SAY the script?
 * Comparison is on letters and digits only, by three-letter sequences, so "A.I." matches "AI" and
 * "Work Cue" matches "WorkCue". Advisory: recognizers mishear names and spelled numbers.
 */
export const MIN_HEARD = 0.7;

const letters = (s: string): string => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");

function trigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 3 <= s.length; i++) out.push(s.slice(i, i + 3));
  return out;
}

/** Narration texts -> sentence-level phrases. */
export function splitPhrases(narrations: string[]): string[] {
  return narrations.flatMap((n) => n.split(/(?<=[.!?])\s+/)).map((p) => p.trim()).filter(Boolean);
}

/** Phrases whose three-letter sequences mostly do not occur in the heard text. */
export function droppedPhrases(phrases: string[], heard: string, minHeard = MIN_HEARD): string[] {
  const heardSet = new Set(trigrams(letters(heard)));
  return phrases.filter((p) => {
    const t = trigrams(letters(p));
    if (t.length === 0) return false;
    const hit = t.filter((g) => heardSet.has(g)).length;
    return hit / t.length < minHeard;
  });
}
