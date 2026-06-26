import type { Alignment } from "./types";

function fmt(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** Split alignment into per-word spans (start/end in absolute seconds). */
function wordsFromAlignment(a: Alignment, offset: number): { start: number; end: number; word: string }[] {
  const words: { start: number; end: number; word: string }[] = [];
  let cur = ""; let start = 0; let last = 0;
  const flush = () => {
    if (cur.trim()) words.push({ start: start + offset, end: last + offset, word: cur.trim() });
    cur = "";
  };
  a.chars.forEach((c, i) => {
    if (cur === "") start = a.startSec[i]!;
    cur += c; last = a.endSec[i]!;
    if (/\s/.test(c)) flush();
  });
  flush();
  return words;
}

/**
 * Produce karaoke-style SRT: one cue per word, where each cue's text is the
 * cumulative sentence up to and including that word.  This ensures every word
 * appears in the SRT output and the full sentence is visible as each word is
 * spoken.
 */
export function toSrt(shots: { alignment: Alignment; startSec: number }[]): string {
  const cues: { start: number; end: number; text: string }[] = [];
  for (const shot of shots) {
    const words = wordsFromAlignment(shot.alignment, shot.startSec);
    for (let i = 0; i < words.length; i++) {
      const start = words[i]!.start;
      const end = i + 1 < words.length ? words[i + 1]!.start : words[i]!.end;
      const text = words.slice(0, i + 1).map((w) => w.word).join(" ");
      cues.push({ start, end, text });
    }
  }
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join("\n\n") + "\n";
}
