/**
 * screencast.ts — pure helpers for the screencast capture engine
 *
 * The screencast engine captures JPEG frames with CDP timestamps and assembles
 * them into an H.264 segment via ffmpeg's concat demuxer. The per-frame duration
 * list derived here IS the segment's presentation timeline: frame timestamps are
 * the sync anchor (recordVideo's nonlinear drift is what this replaces).
 *
 * Pure module: no playwright, no fs. Mirrors ffmpeg.ts's escaping rules.
 */

import { concatListEntry } from "./ffmpeg";

/** Floor for a single frame's display time; guards non-monotonic CDP timestamps. */
export const MIN_FRAME_SEC = 0.001;

/**
 * Screencast onFrame timestamps arrive in MILLISECONDS (playwright
 * monotonicTime). Convert at the ingestion boundary; every pure helper below
 * operates in seconds. Regression guard: treating ms as seconds inflated an
 * 8-second smoke demo to 7726s (caught by the parity max-duration gate).
 */
export function frameTimestampsToSec(timestampsMs: number[]): number[] {
  return timestampsMs.map((t) => t / 1000);
}

/**
 * Per-frame durations from capture timestamps (seconds). Frame i is displayed
 * from ts[i] to ts[i+1]; the last frame runs until stopTs. Non-positive gaps
 * (clock skew, duplicate timestamps, stopTs before the last frame) clamp to
 * MIN_FRAME_SEC rather than producing a zero/negative duration the concat
 * demuxer would reject.
 */
export function frameDurations(timestamps: number[], stopTs: number): number[] {
  return timestamps.map((ts, i) => {
    const next = i + 1 < timestamps.length ? timestamps[i + 1]! : stopTs;
    return Math.max(MIN_FRAME_SEC, next - ts);
  });
}

/**
 * Which cursor rendering path is active. Exactly one is ever visible:
 * Playwright's native showActions cursor when the screencast engine runs with
 * annotations enabled; otherwise the legacy injected overlay cursor per
 * theme.cursor; otherwise none. Prevents the double-cursor failure mode.
 */
export function cursorMode(
  engine: "screencast" | "recordvideo",
  annotationsEnabled: boolean,
  themeCursor: boolean,
): "native" | "overlay" | "none" {
  if (engine === "screencast" && annotationsEnabled) return "native";
  return themeCursor ? "overlay" : "none";
}

/**
 * Concat-demuxer list content for an image sequence with explicit durations.
 * The demuxer ignores the duration directive after the final entry, so the last
 * file is listed once more to make its duration bind.
 */
export function framesConcatContent(files: string[], durations: number[]): string {
  if (files.length === 0) throw new Error("framesConcatContent: no frames captured");
  if (files.length !== durations.length) {
    throw new Error(
      `framesConcatContent: files/durations length mismatch (${files.length} vs ${durations.length})`,
    );
  }
  const lines: string[] = [];
  for (let i = 0; i < files.length; i++) {
    lines.push(concatListEntry(files[i]!));
    lines.push(`duration ${durations[i]!.toFixed(6)}`);
  }
  lines.push(concatListEntry(files[files.length - 1]!));
  return lines.join("\n");
}
