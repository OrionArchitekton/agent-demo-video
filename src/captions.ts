import type { Alignment } from "./types";

function fmt(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/**
 * Produce one SRT cue per shot: full narration text spanning
 * [startSec + first-char-start, startSec + last-char-end].
 * Shots with empty alignment are skipped.
 */
export function toSrt(shots: { alignment: Alignment; startSec: number }[]): string {
  const cues: { start: number; end: number; text: string }[] = [];
  for (const shot of shots) {
    const { alignment, startSec } = shot;
    if (alignment.chars.length === 0) continue;
    const start = startSec + alignment.startSec[0]!;
    const end = startSec + alignment.endSec[alignment.endSec.length - 1]!;
    const text = alignment.chars.join("").trim();
    cues.push({ start, end, text });
  }
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join("\n\n") + "\n";
}
