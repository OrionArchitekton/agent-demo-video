import { describe, it, expect } from "vitest";
import { zoomWindows, zoomLevelAt, zoomFilterExpr, type InteractionEvent } from "./motion";

const ev = (tMs: number, x = 800, y = 400, w = 200, h = 50): InteractionEvent => ({
  kind: "click",
  tMs,
  box: { x, y, width: w, height: h },
});

const OPTS = { width: 1920, height: 1080, fps: 30, durationSec: 10, zoom: 1.35, inSec: 0.6, holdSec: 0.9, outSec: 0.6 };

describe("zoomWindows", () => {
  it("builds one window per event, clamped to the segment duration", () => {
    const w = zoomWindows([ev(1000)], OPTS);
    expect(w).toHaveLength(1);
    expect(w[0]!.startSec).toBeCloseTo(1.0, 6);
    expect(w[0]!.endSec).toBeCloseTo(1.0 + 0.6 + 0.9 + 0.6, 6);
  });

  it("drops windows that would start after the segment ends and merges overlapping windows to the earlier event", () => {
    const w = zoomWindows([ev(1000), ev(1200), ev(30000)], OPTS);
    expect(w).toHaveLength(1);
    expect(w[0]!.startSec).toBeCloseTo(1.0, 6);
  });

  it("returns [] for no events", () => {
    expect(zoomWindows([], OPTS)).toEqual([]);
  });
});

describe("zoomLevelAt", () => {
  it("eases 1 -> zoom -> 1 across a window and is 1 outside it", () => {
    const [w] = zoomWindows([ev(1000)], OPTS);
    expect(zoomLevelAt(0.5, [w!], OPTS.zoom)).toBe(1);
    expect(zoomLevelAt(1.0, [w!], OPTS.zoom)).toBeCloseTo(1, 3);
    expect(zoomLevelAt(1.6, [w!], OPTS.zoom)).toBeCloseTo(OPTS.zoom, 3);
    expect(zoomLevelAt(2.0, [w!], OPTS.zoom)).toBeCloseTo(OPTS.zoom, 3);
    expect(zoomLevelAt(3.1, [w!], OPTS.zoom)).toBeCloseTo(1, 3);
    expect(zoomLevelAt(9.9, [w!], OPTS.zoom)).toBe(1);
  });
});

describe("zoomFilterExpr", () => {
  it("returns undefined when there are no windows (segment renders unchanged)", () => {
    expect(zoomFilterExpr([], OPTS)).toBeUndefined();
  });

  it("emits a zoompan filter at output size and fps, anchored on the event window times in input-time", () => {
    const expr = zoomFilterExpr([ev(1000)], OPTS)!;
    expect(expr).toMatch(/^zoompan=/);
    expect(expr).toContain("s=1920x1080");
    expect(expr).toContain("fps=30");
    expect(expr).toContain("d=1");
    expect(expr).toContain("between(it,1.000");
    expect(expr).not.toContain("--");
  });
});

describe("zero-length ease phases", () => {
  it("emits no division by a zero phase length (snap zoom instead of 0/0 NaN)", () => {
    const opts = { ...OPTS, inSec: 0, outSec: 0 };
    const expr = zoomFilterExpr([ev(1000)], opts)!;
    expect(expr).not.toMatch(/\/0\.000/);
    expect(expr).not.toContain("NaN");
  });
});

describe("pipeline findings", () => {
  it("returns no windows (and no NaN) when all phase durations are zero", () => {
    const opts = { ...OPTS, inSec: 0, holdSec: 0, outSec: 0 };
    expect(zoomWindows([ev(1000)], opts)).toEqual([]);
    expect(zoomFilterExpr([ev(1000)], opts)).toBeUndefined();
  });

  it("extends the active window through an overlapping event instead of dropping it", () => {
    const w = zoomWindows([ev(1000), ev(1200)], OPTS);
    expect(w).toHaveLength(1);
    expect(w[0]!.endSec).toBeCloseTo(1.2 + 2.1, 6);
  });
});

describe("living camera (S4)", () => {
  const CAM = { width: 1920, height: 1080, fps: 30, durationSec: 12, baseZoom: 1.08, zoom: 1.32, inSec: 0.6, holdSec: 0.9, outSec: 0.6, driftAmp: 0.012, driftPeriodSec: 11 };

  it("with no events still returns a base-state camera (never a static wide)", async () => {
    const { cameraKeyframes, cameraFilterExpr } = await import("./motion");
    const kf = cameraKeyframes([], CAM);
    expect(kf[0]).toMatchObject({ t: 0, z: 1.08, fx: 0.5, fy: 0.5 });
    expect(kf[kf.length - 1]!.t).toBeCloseTo(12, 6);
    const expr = cameraFilterExpr([], CAM)!;
    expect(expr).toMatch(/^zoompan=/);
    expect(expr).toContain("sin(");
  });

  it("holds base until an event, eases to the target, and returns to base after", async () => {
    const { cameraKeyframes, cameraStateAt } = await import("./motion");
    const kf = cameraKeyframes([ev(3000)], CAM);
    expect(cameraStateAt(1.5, kf).z).toBeCloseTo(1.08, 3);
    const atPeak = cameraStateAt(3.6, kf);
    expect(atPeak.z).toBeCloseTo(1.32, 3);
    expect(atPeak.fx).toBeCloseTo(800 / 1920 + 100 / 1920, 2);
    expect(cameraStateAt(6.0, kf).z).toBeCloseTo(1.08, 3);
  });

  it("travels directly between two nearby events without returning to base", async () => {
    const { cameraKeyframes, cameraStateAt } = await import("./motion");
    const kf = cameraKeyframes([ev(3000, 400, 300), ev(4200, 1400, 700)], CAM);
    const between = cameraStateAt(4.2, kf);
    expect(between.z).toBeGreaterThan(1.2);
    const atSecond = cameraStateAt(4.8, kf);
    expect(atSecond.fx).toBeCloseTo((1400 + 100) / 1920, 2);
  });
});

describe("living camera review fixes", () => {
  const CAM2 = { width: 1920, height: 1080, fps: 30, durationSec: 10, baseZoom: 1.08, zoom: 1.32, inSec: 0.6, holdSec: 0.9, outSec: 0.6, driftAmp: 0.012, driftPeriodSec: 11 };
  it("always eases back to base by the end of the shot, even for a late event", async () => {
    const { cameraKeyframes, cameraStateAt } = await import("./motion");
    const kf = cameraKeyframes([ev(9500)], CAM2);
    const end = cameraStateAt(10, kf);
    expect(end.z).toBeCloseTo(1.08, 3);
    expect(end.fx).toBeCloseTo(0.5, 3);
  });
  it("merges events closer than the ease-in window instead of snapping between targets", async () => {
    const { cameraKeyframes } = await import("./motion");
    const kf = cameraKeyframes([ev(3000, 400, 300), ev(3200, 1400, 700)], CAM2);
    const focused = kf.filter((k) => Math.abs(k.z - 1.32) < 1e-6);
    const fxs = new Set(focused.map((k) => k.fx.toFixed(3)));
    expect(fxs.size).toBe(1);
  });
});

describe("cameraKeyframes merged-event cycle (pipeline finding)", () => {
  const CAM3 = { width: 1920, height: 1080, fps: 30, durationSec: 10, baseZoom: 1.08, zoom: 1.32, inSec: 0.6, holdSec: 0.9, outSec: 0.6, driftAmp: 0.012, driftPeriodSec: 11 };
  it("a merged trailing event does not suppress the survivor's hold/ease-back", async () => {
    const { cameraKeyframes, cameraStateAt } = await import("./motion");
    // 3.2s arrives while the camera is still easing toward 3.0s: it merges, and
    // the surviving 3.0s event must still ease back by 3.0+in+hold+out = 5.1s.
    const kf = cameraKeyframes([ev(3000, 400, 300), ev(3200, 1400, 700)], CAM3);
    const after = cameraStateAt(5.2, kf);
    expect(after.z).toBeCloseTo(CAM3.baseZoom, 3);
    expect(after.fx).toBeCloseTo(0.5, 3);
  });
});

describe("cameraMode (adversarial finding: zoomOnAction is the master motion switch)", () => {
  it("zoomOnAction=false disables ALL camera motion, including the living camera", async () => {
    const { cameraMode } = await import("./motion");
    expect(cameraMode(false, true)).toBe("none");
    expect(cameraMode(false, false)).toBe("none");
    expect(cameraMode(true, true)).toBe("living");
    expect(cameraMode(true, false)).toBe("legacy");
  });
});
