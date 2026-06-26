import type { Alignment } from "./types";

const SEC_PER_WORD = 0.38;
const FLOOR_SEC = 1.0;

export function estimateDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(FLOOR_SEC, words * SEC_PER_WORD);
}

export function synthAlignment(text: string, durationSec: number): Alignment {
  const chars = [...text];
  const n = Math.max(chars.length, 1);
  const per = durationSec / n;
  const startSec = chars.map((_, i) => +(i * per).toFixed(6));
  const endSec = chars.map((_, i) => +((i + 1) * per).toFixed(6));
  return { chars, startSec, endSec };
}
