/**
 * motion.ts — zoom-on-action camera motion from the interaction event timeline
 *
 * Pure module: converts the events recorded during capture (element bounds +
 * capture-relative time offsets) into an ffmpeg zoompan filter that eases the
 * frame toward the acted-on region and back out. zoompan (d=1, input-time
 * anchored) is used because crop evaluates out_w/out_h only at init, so it can
 * pan but never zoom per-frame. Zoom never alters frame count or duration.
 */

export interface InteractionEvent {
  kind: string;
  /** Capture-relative time of the interaction in milliseconds. */
  tMs: number;
  /** Viewport bounding box of the interacted element. */
  box: { x: number; y: number; width: number; height: number };
}

export interface ZoomOpts {
  width: number;
  height: number;
  fps: number;
  /** Segment duration in seconds; windows are clamped to it. */
  durationSec: number;
  /** Peak zoom level (1 = no zoom). */
  zoom: number;
  inSec: number;
  holdSec: number;
  outSec: number;
}

export interface ZoomWindow {
  startSec: number;
  endSec: number;
  /** Ease-in / ease-out phase lengths in seconds (proportionally shrunk when the window is end-clamped). */
  inLen: number;
  outLen: number;
  /** Focus fractions of the frame (0..1) toward the event center. */
  fx: number;
  fy: number;
}

/** Smoothstep ease, clamped. */
function ease(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return c * c * (3 - 2 * c);
}

/**
 * One window per qualifying event, sorted by time. An event starting inside an
 * earlier window is dropped (the earlier event keeps the camera); events at or
 * beyond the segment end are dropped; window ends clamp to the segment end.
 */
export function zoomWindows(events: InteractionEvent[], opts: ZoomOpts): ZoomWindow[] {
  const span = opts.inSec + opts.holdSec + opts.outSec;
  const windows: ZoomWindow[] = [];
  const sorted = [...events].sort((a, b) => a.tMs - b.tMs);
  for (const e of sorted) {
    const startSec = e.tMs / 1000;
    if (startSec >= opts.durationSec) continue;
    const last = windows[windows.length - 1];
    if (last && startSec < last.endSec) continue;
    const endSec = Math.min(startSec + span, opts.durationSec);
    const scale = (endSec - startSec) / span;
    windows.push({
      startSec,
      endSec,
      inLen: opts.inSec * scale,
      outLen: opts.outSec * scale,
      fx: Math.min(1, Math.max(0, (e.box.x + e.box.width / 2) / opts.width)),
      fy: Math.min(1, Math.max(0, (e.box.y + e.box.height / 2) / opts.height)),
    });
  }
  return windows;
}

/**
 * Zoom level at time t (seconds) for the given windows: 1 outside any window,
 * easing 1 -> zoom over inSec, holding, easing back over outSec. TS twin of
 * the generated ffmpeg expression, unit-testable numerically.
 */
export function zoomLevelAt(t: number, windows: ZoomWindow[], zoom: number): number {
  for (const w of windows) {
    if (t < w.startSec || t > w.endSec) continue;
    const span = w.endSec - w.startSec;
    const rel = t - w.startSec;
    const outStart = span - w.outLen;
    if (rel <= w.inLen) return 1 + (zoom - 1) * ease(w.inLen === 0 ? 1 : rel / w.inLen);
    if (rel >= outStart) return zoom - (zoom - 1) * ease(w.outLen === 0 ? 1 : (rel - outStart) / w.outLen);
    return zoom;
  }
  return 1;
}

const f3 = (n: number) => n.toFixed(3);

/**
 * Build the zoompan filter string for the event timeline, or undefined when no
 * window qualifies (the segment renders unchanged). Expressions are anchored on
 * input time (`it`), evaluated per input frame with d=1 (no frame count change).
 */
export function zoomFilterExpr(events: InteractionEvent[], opts: ZoomOpts): string | undefined {
  const windows = zoomWindows(events, opts);
  if (windows.length === 0) return undefined;

  // z(t): nested piecewise over windows; 1 elsewhere.
  let z = "1";
  let fx = "0.5";
  let fy = "0.5";
  for (const w of [...windows].reverse()) {
    const a = w.startSec;
    const b = w.endSec;
    const inEnd = a + w.inLen;
    const outStart = b - w.outLen;
    const inLen = w.inLen;
    const outLen = w.outLen;
    const Z = opts.zoom;
    const easeIn = `st(0,clip((it-${f3(a)})/${f3(inLen)},0,1));1+${f3(Z - 1)}*ld(0)*ld(0)*(3-2*ld(0))`;
    const easeOut = `st(0,clip((it-${f3(outStart)})/${f3(outLen)},0,1));${f3(Z)}-${f3(Z - 1)}*ld(0)*ld(0)*(3-2*ld(0))`;
    const phase = `if(lt(it,${f3(inEnd)}),${easeIn},if(lt(it,${f3(outStart)}),${f3(Z)},${easeOut}))`;
    z = `if(between(it,${f3(a)},${f3(b)}),${phase},${z})`;
    fx = `if(between(it,${f3(a)},${f3(b)}),${f3(w.fx)},${fx})`;
    fy = `if(between(it,${f3(a)},${f3(b)}),${f3(w.fy)},${fy})`;
  }

  const x = `clip((${fx})*iw-iw/zoom/2,0,iw-iw/zoom)`;
  const y = `clip((${fy})*ih-ih/zoom/2,0,ih-ih/zoom)`;
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${opts.width}x${opts.height}:fps=${opts.fps}`;
}
