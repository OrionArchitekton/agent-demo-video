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
