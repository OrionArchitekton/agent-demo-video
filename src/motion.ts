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
 * active window EXTENDS that window's hold through the new event (the camera
 * stays in rather than re-zooming or dropping the interaction); events at or
 * beyond the segment end are dropped; window ends clamp to the segment end.
 * Zero total span (all phase durations 0) means zoom is a no-op: no windows.
 */
export function zoomWindows(events: InteractionEvent[], opts: ZoomOpts): ZoomWindow[] {
  const span = opts.inSec + opts.holdSec + opts.outSec;
  if (span <= 0) return [];
  const windows: ZoomWindow[] = [];
  const sorted = [...events].sort((a, b) => a.tMs - b.tMs);
  for (const e of sorted) {
    const startSec = e.tMs / 1000;
    if (startSec >= opts.durationSec) continue;
    const last = windows[windows.length - 1];
    if (last && startSec < last.endSec) {
      last.endSec = Math.min(Math.max(last.endSec, startSec + span), opts.durationSec);
      continue;
    }
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

// ---------------------------------------------------------------------------
// Living camera (production-polish S4): a continuous camera at a gentle base
// zoom that eases toward each action target and on to the next, instead of
// zooming in and out per event. Keyframes are pure and unit-tested; the ffmpeg
// expression interpolates the same keyframes with smoothstep, plus a slow
// additive drift in z (expression-only; the TS twin models the keyframe path).
// ---------------------------------------------------------------------------

export interface CameraOpts {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  baseZoom: number;
  zoom: number;
  inSec: number;
  holdSec: number;
  outSec: number;
  driftAmp: number;
  driftPeriodSec: number;
}

export interface CamKeyframe { t: number; z: number; fx: number; fy: number }

/** Piecewise camera keyframes: hold base, ease to targets, travel directly between nearby events, return to base. */
export function cameraKeyframes(events: InteractionEvent[], o: CameraOpts): CamKeyframe[] {
  const base = { z: o.baseZoom, fx: 0.5, fy: 0.5 };
  const kf: CamKeyframe[] = [{ t: 0, ...base }];
  let last = { ...base };
  let cursor = 0;

  const sorted = [...events]
    .filter((e) => e.tMs / 1000 < o.durationSec)
    .sort((a, b) => a.tMs - b.tMs);

  const push = (t: number, s: { z: number; fx: number; fy: number }) => {
    const prev = kf[kf.length - 1]!;
    if (t <= prev.t + 1e-6) return;
    kf.push({ t, ...s });
  };

  // The camera must be back at base by the end of the shot (spec S4): events
  // whose full ease cycle cannot fit are clamped so the ease-back always runs.
  const lastEaseStart = o.durationSec - o.outSec;

  // Merge pass BEFORE building the path: an event arriving while the camera is
  // still easing toward the previous target would force a near-instant re-pan,
  // so it is dropped here — where it cannot also masquerade as the survivor's
  // `next` and suppress that event's hold/ease-back cycle.
  const kept: InteractionEvent[] = [];
  let prevInEnd = -Infinity;
  for (const e of sorted) {
    const evT = e.tMs / 1000;
    if (evT < prevInEnd) continue;
    // An event inside the final ease-back window has no room for ANY cycle
    // (ease-in would collide with the mandatory return to base). Dropping it
    // here is deliberate: the alternative — retargeting the collided keyframe —
    // would re-slope the entire preceding span into a shot-long creep toward
    // the focus, which is far worse than skipping one last-instant zoom.
    if (evT >= lastEaseStart) continue;
    kept.push(e);
    prevInEnd = Math.min(evT + o.inSec, Math.max(evT, lastEaseStart));
  }

  for (let i = 0; i < kept.length; i++) {
    const e = kept[i]!;
    const evT = e.tMs / 1000;
    const focus = {
      z: o.zoom,
      fx: Math.min(1, Math.max(0, (e.box.x + e.box.width / 2) / o.width)),
      fy: Math.min(1, Math.max(0, (e.box.y + e.box.height / 2) / o.height)),
    };
    if (evT > cursor) push(evT, last);
    const inEnd = Math.min(evT + o.inSec, Math.max(evT, lastEaseStart));
    push(inEnd, focus);
    last = focus;
    const holdEnd = Math.min(inEnd + o.holdSec, Math.max(inEnd, lastEaseStart));
    // Survivors of the merge pass always start at or after this event's inEnd.
    const next = kept[i + 1];
    if (next && next.tMs / 1000 <= holdEnd + o.outSec) {
      // Travel directly to the next target: hold here until its ease begins.
      cursor = Math.max(inEnd, Math.min(next.tMs / 1000, holdEnd));
      push(cursor, last);
    } else {
      push(holdEnd, last);
      const outEnd = Math.min(holdEnd + o.outSec, o.durationSec);
      push(outEnd, base);
      last = { ...base };
      cursor = outEnd;
    }
  }
  push(o.durationSec, last);
  // Guarantee the final state is base even when a late event's ease-back was
  // squeezed: replace a non-base terminal keyframe with an explicit ramp.
  const terminal = kf[kf.length - 1]!;
  if (terminal.z !== o.baseZoom || terminal.fx !== 0.5 || terminal.fy !== 0.5) {
    terminal.z = o.baseZoom;
    terminal.fx = 0.5;
    terminal.fy = 0.5;
  }
  return kf;
}

/** Camera-motion engine selection. `zoomOnAction` is the master motion
 *  off-switch (the documented pre-slate contract): false disables ALL camera
 *  motion, living camera included, so legacy configs keep a still capture. */
export type CameraMode = "living" | "legacy" | "none";
export function cameraMode(zoomOnAction: boolean, livingCamera: boolean): CameraMode {
  if (!zoomOnAction) return "none";
  return livingCamera ? "living" : "legacy";
}

/** TS twin of the generated expression's keyframe path (drift excluded). */
export function cameraStateAt(t: number, kf: CamKeyframe[]): { z: number; fx: number; fy: number } {
  if (t <= kf[0]!.t) return kf[0]!;
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i]!;
    const b = kf[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const p = ease(span === 0 ? 1 : (t - a.t) / span);
      return { z: a.z + (b.z - a.z) * p, fx: a.fx + (b.fx - a.fx) * p, fy: a.fy + (b.fy - a.fy) * p };
    }
  }
  return kf[kf.length - 1]!;
}

/** Nested piecewise smoothstep expression over keyframes for one channel. */
function piecewiseExpr(kf: CamKeyframe[], pick: (k: CamKeyframe) => number): string {
  let expr = f3(pick(kf[kf.length - 1]!));
  for (let i = kf.length - 2; i >= 0; i--) {
    const a = kf[i]!;
    const b = kf[i + 1]!;
    const av = f3(pick(a));
    const bv = f3(pick(b));
    const span = b.t - a.t;
    const seg =
      av === bv || span <= 0
        ? av
        : `st(0,clip((it-${f3(a.t)})/${f3(span)},0,1));${av}+(${bv}-${av})*ld(0)*ld(0)*(3-2*ld(0))`;
    expr = `if(lt(it,${f3(b.t)}),${seg},${expr})`;
  }
  return expr;
}

/**
 * zoompan filter for the living camera. Never returns undefined: with no
 * events the base zoom and drift still apply (no static full-wide shots).
 */
export function cameraFilterExpr(events: InteractionEvent[], o: CameraOpts): string {
  const kf = cameraKeyframes(events, o);
  const z = `(${piecewiseExpr(kf, (k) => k.z)})+${o.driftAmp}*sin(2*PI*it/${f3(o.driftPeriodSec)})`;
  const fx = piecewiseExpr(kf, (k) => k.fx);
  const fy = piecewiseExpr(kf, (k) => k.fy);
  const x = `clip((${fx})*iw-iw/zoom/2,0,iw-iw/zoom)`;
  const y = `clip((${fy})*ih-ih/zoom/2,0,ih-ih/zoom)`;
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${o.width}x${o.height}:fps=${o.fps}`;
}

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
    // A phase whose length rounds to 0 at expression precision would emit a
    // 0/0 division; snap straight to the target level instead (matches the TS
    // twin's zero-length guards in zoomLevelAt).
    const zeroLen = (n: number) => n < 0.0005;
    const easeIn = zeroLen(inLen)
      ? f3(Z)
      : `st(0,clip((it-${f3(a)})/${f3(inLen)},0,1));1+${f3(Z - 1)}*ld(0)*ld(0)*(3-2*ld(0))`;
    const easeOut = zeroLen(outLen)
      ? f3(Z)
      : `st(0,clip((it-${f3(outStart)})/${f3(outLen)},0,1));${f3(Z)}-${f3(Z - 1)}*ld(0)*ld(0)*(3-2*ld(0))`;
    const phase = `if(lt(it,${f3(inEnd)}),${easeIn},if(lt(it,${f3(outStart)}),${f3(Z)},${easeOut}))`;
    z = `if(between(it,${f3(a)},${f3(b)}),${phase},${z})`;
    fx = `if(between(it,${f3(a)},${f3(b)}),${f3(w.fx)},${fx})`;
    fy = `if(between(it,${f3(a)},${f3(b)}),${f3(w.fy)},${fy})`;
  }

  const x = `clip((${fx})*iw-iw/zoom/2,0,iw-iw/zoom)`;
  const y = `clip((${fy})*ih-ih/zoom/2,0,ih-ih/zoom)`;
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${opts.width}x${opts.height}:fps=${opts.fps}`;
}
