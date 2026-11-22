/**
 * zoom-shots.ts: click-driven camera shot planner.
 *
 * Pure and deterministic, with no model involved. Nearby interactions share one
 * zoom that arrives before the first and holds after the last.
 *
 * Adapted from OpenScreen's src/lib/ai-edition/timeline/zoom-suggestions.ts
 * (MIT, see THIRD-PARTY-NOTICES.md). Changed for this pipeline: bounds are per
 * captured shot because each shot encodes separately, the zoom is continuous
 * up to motion.zoomLevel, and events carry element boxes instead of telemetry.
 */
import type { CamKeyframe, CameraOpts, InteractionEvent } from "./motion";

/** Interactions closer than this share one zoom when they fit in it together. */
export const SHOT_MERGE_GAP_MS = 3000;
/** A zoom is fully in this long before its first interaction. */
export const SHOT_LEAD_MS = 500;
/** A zoom holds this long after its last interaction, to show the result. */
export const SHOT_TAIL_MS = 1500;
/** The shortest time a zoom holds, fully in. */
export const MIN_SHOT_HOLD_MS = 1800;
/** The shortest wide shot between two zooms, ramps excluded. Less reads as a yo-yo. */
export const MIN_WIDE_BETWEEN_MS = 1500;
/** Margin kept around framed interactions, as a fraction of the frame. */
export const SHOT_FIT_MARGIN = 0.12;
/** A group needing less magnification than this is not worth a zoom. */
export const MIN_FIT_ZOOM = 1.25;

export interface ShotPlanOpts {
  width: number;
  height: number;
  durationSec: number;
  /** Deepest zoom a shot may use. */
  zoom: number;
  /** The camera's resting zoom: a shot never needs to be wider than this. */
  baseZoom?: number;
  inSec: number;
  outSec: number;
}

export interface PlannedShot {
  /** Fully zoomed in from here. */
  startSec: number;
  /** Starts easing back out here. */
  endSec: number;
  zoom: number;
  fx: number;
  fy: number;
  events: number;
}

interface Box { minX: number; maxX: number; minY: number; maxY: number }
interface Point { tMs: number; doneMs: number; box: Box }
interface Shot { start: number; end: number; zoom: number; box: Box; events: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  maxX: Math.max(a.maxX, b.maxX),
  minY: Math.min(a.minY, b.minY),
  maxY: Math.max(a.maxY, b.maxY),
});

/** The deepest allowed zoom that shows the whole box with its margin, or null. */
function fitZoom(box: Box, o: ShotPlanOpts): number | null {
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY) + 2 * SHOT_FIT_MARGIN;
  const fit = 1 / size;
  const floor = Math.max(Math.min(MIN_FIT_ZOOM, o.zoom), o.baseZoom ?? 1);
  return fit >= floor ? Math.min(fit, o.zoom) : null;
}

function points(events: InteractionEvent[], o: ShotPlanOpts): Point[] {
  const totalMs = o.durationSec * 1000;
  return events
    .filter((e) =>
      [e.tMs, e.box?.x, e.box?.y, e.box?.width, e.box?.height].every(Number.isFinite)
      && e.tMs >= 0 && e.tMs < totalMs)
    .map((e) => ({
      tMs: Math.round(e.tMs),
      doneMs: Math.round(Number.isFinite(e.endMs) ? Math.max(e.tMs, e.endMs!) : e.tMs),
      box: {
        minX: clamp01(e.box.x / o.width),
        maxX: clamp01((e.box.x + e.box.width) / o.width),
        minY: clamp01(e.box.y / o.height),
        maxY: clamp01((e.box.y + e.box.height) / o.height),
      },
    }))
    .sort((a, b) => a.tMs - b.tMs);
}

function groupShots(pts: Point[], o: ShotPlanOpts): Shot[] {
  const earliest = Math.ceil(o.inSec * 1000);
  const latest = Math.floor((o.durationSec - o.outSec) * 1000);
  const groups: { first: number; last: number; count: number; box: Box }[] = [];
  for (const p of pts) {
    // An action outside the fully zoomed span of this segment cannot be shown.
    if (p.tMs < earliest || p.doneMs > latest) continue;
    if (fitZoom(p.box, o) === null) continue;
    const group = groups[groups.length - 1];
    if (group && p.tMs - group.last <= SHOT_MERGE_GAP_MS) {
      const box = union(group.box, p.box);
      if (fitZoom(box, o) !== null) {
        group.last = Math.max(group.last, p.doneMs);
        group.count++;
        group.box = box;
        continue;
      }
    }
    groups.push({ first: p.tMs, last: p.doneMs, count: 1, box: p.box });
  }

  const shots: Shot[] = [];
  for (const { first, last, count, box } of groups) {
    const zoom = fitZoom(box, o);
    if (zoom === null) continue;
    // Near the end, the zoom arrives earlier rather than holding too briefly.
    const start = Math.max(Math.min(first - SHOT_LEAD_MS, latest - MIN_SHOT_HOLD_MS), earliest);
    const end = Math.min(Math.max(last + SHOT_TAIL_MS, start + MIN_SHOT_HOLD_MS), latest);
    if (end - start < MIN_SHOT_HOLD_MS) continue;
    shots.push({ start, end, zoom, box, events: count });
  }
  return shots;
}

/**
 * No yo-yo: between two zooms, a real wide shot or none at all. Shots too close
 * merge when they fit one frame; otherwise the one with fewer interactions goes,
 * the later one on a tie.
 */
function resolveShots(input: Shot[], o: ShotPlanOpts): Shot[] {
  const plan = [...input].sort((a, b) => a.start - b.start);
  const rampMs = (o.inSec + o.outSec) * 1000;
  for (let i = 0; i + 1 < plan.length; ) {
    const a = plan[i]!;
    const b = plan[i + 1]!;
    if (b.start - a.end - rampMs >= MIN_WIDE_BETWEEN_MS) {
      i++;
      continue;
    }
    const box = union(a.box, b.box);
    const zoom = fitZoom(box, o);
    if (zoom !== null) {
      plan.splice(i, 2, {
        start: a.start,
        end: Math.max(a.end, b.end),
        zoom,
        box,
        events: a.events + b.events,
      });
    } else {
      plan.splice(a.events >= b.events ? i + 1 : i, 1);
    }
    // The survivor may now clash with the shot before it.
    i = Math.max(0, i - 1);
  }
  return plan;
}

/** Plan the zoom shots of one captured segment. */
export function planZoomShots(events: InteractionEvent[], o: ShotPlanOpts): PlannedShot[] {
  if (!(o.durationSec > 0) || o.zoom <= (o.baseZoom ?? 1)) return [];
  return resolveShots(groupShots(points(events, o), o), o).map((s) => ({
    startSec: s.start / 1000,
    endSec: s.end / 1000,
    zoom: s.zoom,
    fx: (s.box.minX + s.box.maxX) / 2,
    fy: (s.box.minY + s.box.maxY) / 2,
    events: s.events,
  }));
}

/**
 * Camera keyframes for the planned shots: base, ease in so the zoom lands at
 * the shot start, hold, ease back to base. A zero-length ramp becomes one frame
 * so keyframe times stay strictly increasing.
 */
export function plannedCameraKeyframes(events: InteractionEvent[], o: CameraOpts): CamKeyframe[] {
  const frameSec = 1 / o.fps;
  const inSec = Math.max(o.inSec, frameSec);
  const outSec = Math.max(o.outSec, frameSec);
  const base = { z: o.baseZoom, fx: 0.5, fy: 0.5 };
  const atMs = (sec: number) => Math.round(sec * 1000) / 1000;
  const kf: CamKeyframe[] = [{ t: 0, ...base }];
  const push = (t: number, s: { z: number; fx: number; fy: number }) => {
    if (t > kf[kf.length - 1]!.t) kf.push({ t, ...s });
  };
  for (const shot of planZoomShots(events, { ...o, inSec, outSec })) {
    const focus = { z: shot.zoom, fx: shot.fx, fy: shot.fy };
    push(atMs(shot.startSec - inSec), base);
    push(atMs(shot.startSec), focus);
    push(atMs(shot.endSec), focus);
    push(atMs(shot.endSec + outSec), base);
  }
  push(o.durationSec, base);
  return kf;
}
