import { describe, expect, it } from "vitest";
import { cameraMode, plannedCameraFilterExpr, type InteractionEvent } from "./motion";
import { DemoConfigSchema } from "./types";
import { plannedCameraKeyframes, planZoomShots } from "./zoom-shots";

const W = 1000;
const H = 1000;
/** A click event centred on the given frame fractions. */
const click = (tMs: number, fx = 0.5, fy = 0.5): InteractionEvent => ({
  kind: "click",
  tMs,
  box: { x: fx * W - 10, y: fy * H - 10, width: 20, height: 20 },
});
const OPTS = { width: W, height: H, durationSec: 20, zoom: 1.35, inSec: 0.6, outSec: 0.6 };

describe("planZoomShots: grouping", () => {
  it("arrives before the click and holds after it", () => {
    const [shot, ...rest] = planZoomShots([click(5000, 0.3, 0.4)], OPTS);
    expect(rest).toEqual([]);
    expect(shot).toMatchObject({ startSec: 4.5, endSec: 6.5, zoom: 1.35, events: 1 });
    expect(shot!.fx).toBeCloseTo(0.3, 6);
    expect(shot!.fy).toBeCloseTo(0.4, 6);
  });

  it("shares one shot across nearby clicks and frames their midpoint", () => {
    const shots = planZoomShots([click(5000, 0.3, 0.5), click(7000, 0.5, 0.5)], OPTS);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ startSec: 4.5, endSec: 8.5, events: 2 });
    expect(shots[0]!.fx).toBeCloseTo(0.4, 6);
  });

  it("lowers the zoom so both clicks stay in frame", () => {
    const [shot] = planZoomShots([click(5000, 0.2, 0.5), click(6000, 0.75, 0.5)], OPTS);
    expect(shot!.zoom).toBeCloseTo(1 / (0.55 + 0.24), 6);
  });

  it("ignores invalid events and sorts input", () => {
    const shots = planZoomShots([click(9000), click(Number.NaN), click(8000)], OPTS);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ startSec: 7.5, endSec: 10.5, events: 2 });
  });
});

describe("planZoomShots: no yo-yo", () => {
  it("keeps the busier shot when two close shots cannot share a frame", () => {
    const shots = planZoomShots(
      [click(5000, 0.05, 0.5), click(6000, 0.95, 0.5), click(6500, 0.95, 0.5)],
      OPTS,
    );
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ events: 2 });
    expect(shots[0]!.fx).toBeCloseTo(0.95, 6);
  });

  it("keeps the earlier shot on a tie", () => {
    const shots = planZoomShots([click(5000, 0.05, 0.5), click(6000, 0.95, 0.5)], OPTS);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.fx).toBeCloseTo(0.05, 6);
  });

  it("merges close groups that fit one frame", () => {
    const shots = planZoomShots([click(5000, 0.4, 0.5), click(9000, 0.5, 0.5)], OPTS);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ startSec: 4.5, endSec: 10.5, events: 2 });
  });

  it("keeps two shots with a real wide gap between them", () => {
    const shots = planZoomShots([click(3000, 0.2, 0.5), click(12000, 0.8, 0.5)], OPTS);
    expect(shots).toHaveLength(2);
    const wide = shots[1]!.startSec - OPTS.inSec - (shots[0]!.endSec + OPTS.outSec);
    expect(wide).toBeGreaterThanOrEqual(1.5);
  });
});

describe("planZoomShots: shot bounds", () => {
  it("never starts its ramp before zero", () => {
    const [shot] = planZoomShots([click(800)], OPTS);
    expect(shot!.startSec).toBe(0.6);
  });

  it("drops a click the zoom could only reach afterward", () => {
    expect(planZoomShots([click(200)], OPTS)).toEqual([]);
  });

  it("arrives early near the end and is back out by the end", () => {
    const [shot] = planZoomShots([click(19500)], OPTS);
    expect(shot).toBeUndefined();
    const [late] = planZoomShots([click(18800)], OPTS);
    expect(late!.endSec + OPTS.outSec).toBeLessThanOrEqual(20);
    expect(late!.endSec - late!.startSec).toBeCloseTo(1.8, 6);
  });

  it("plans nothing when the segment cannot hold a zoom", () => {
    expect(planZoomShots([click(1000)], { ...OPTS, durationSec: 2.5 })).toEqual([]);
  });
});

describe("plannedCameraKeyframes", () => {
  const CAM = { ...OPTS, fps: 30, baseZoom: 1.08, holdSec: 0.9, driftAmp: 0.012, driftPeriodSec: 11 };

  it("eases in, holds through the shot, and returns to base", () => {
    const kf = plannedCameraKeyframes([click(5000, 0.3, 0.4)], CAM);
    expect(kf.map((k) => k.t)).toEqual([0, 3.9, 4.5, 6.5, 7.1, 20]);
    expect(kf.map((k) => k.z)).toEqual([1.08, 1.08, 1.35, 1.35, 1.08, 1.08]);
    expect(kf[2]!.fx).toBeCloseTo(0.3, 6);
    expect(kf[5]).toEqual({ t: 20, z: 1.08, fx: 0.5, fy: 0.5 });
  });

  it("holds base with no events", () => {
    expect(plannedCameraKeyframes([], CAM)).toEqual([
      { t: 0, z: 1.08, fx: 0.5, fy: 0.5 },
      { t: 20, z: 1.08, fx: 0.5, fy: 0.5 },
    ]);
  });

  it("never zooms out below the base zoom", () => {
    const kf = plannedCameraKeyframes([click(5000)], { ...CAM, zoom: 1.05 });
    expect(kf.every((k) => k.z === 1.08)).toBe(true);
  });

  it("keeps strictly increasing times with zero-length ramps", () => {
    const kf = plannedCameraKeyframes([click(5000)], { ...CAM, inSec: 0, outSec: 0 });
    for (let i = 1; i < kf.length; i++) expect(kf[i]!.t).toBeGreaterThan(kf[i - 1]!.t);
    expect(Math.max(...kf.map((k) => k.z))).toBe(1.35);
  });

  it("renders through the shared zoompan expression", () => {
    const vf = plannedCameraFilterExpr([click(5000)], CAM);
    expect(vf).toMatch(/^zoompan=z='/);
    expect(vf).toContain("d=1:s=1000x1000:fps=30");
    expect(vf).toContain("1.350");
  });
});

describe("cameraMode with the shot planner", () => {
  it("selects planned only when asked, and the master switch still wins", () => {
    expect(cameraMode(true, true, true)).toBe("planned");
    expect(cameraMode(true, false, true)).toBe("planned");
    expect(cameraMode(false, true, true)).toBe("none");
    expect(cameraMode(true, true, false)).toBe("living");
    expect(cameraMode(true, true)).toBe("living");
  });
});

describe("motion.shotPlanner config", () => {
  it("stays absent by default so existing config digests do not change", () => {
    const base = { script: "x", dashboardBaseUrl: "http://localhost:3000", out: "out" };
    expect("shotPlanner" in DemoConfigSchema.parse(base).motion).toBe(false);
    expect(DemoConfigSchema.parse({ ...base, motion: { shotPlanner: true } }).motion.shotPlanner).toBe(true);
  });
});
