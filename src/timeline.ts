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

/**
 * Reconcile a segment's authoritative duration against its narration.
 *
 * The pipeline treats the measured video-segment duration as authoritative and
 * pads/caps the audio track to it. For LIVE capture that is safe: the capture
 * driver dwells to fill the narration window (see capture.ts). A PREBAKED clip
 * has no dwell, so a clip shorter than its narration would silently truncate the
 * voiceover (the audio `-t` cap in padAudioArgs cuts it). This returns the
 * duration the segment must occupy — never shorter than the narration — plus the
 * deficit of video to add by freezing the last frame (`extendBySec`, 0 when the
 * clip already covers the narration).
 */
export function reconcileSegmentDuration(
  clipSec: number,
  narrationSec: number,
): { durationSec: number; extendBySec: number } {
  return {
    durationSec: Math.max(clipSec, narrationSec),
    extendBySec: Math.max(0, narrationSec - clipSec),
  };
}
