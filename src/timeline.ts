import type { TimelineEntry } from "./types";

export function buildTimeline(shots: { shotId: string; durationSec: number }[]): { entries: TimelineEntry[]; totalSec: number } {
  let acc = 0;
  const entries: TimelineEntry[] = shots.map((s) => {
    const e: TimelineEntry = { shotId: s.shotId, startSec: acc, durationSec: s.durationSec };
    acc += s.durationSec;
    return e;
  });
  return { entries, totalSec: acc };
}

export function padToMax(audioSec: number, actionSec: number): number {
  return Math.max(audioSec, actionSec);
}
