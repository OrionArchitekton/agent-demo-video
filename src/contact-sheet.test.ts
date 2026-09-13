import { describe, it, expect } from "vitest";
import { beatSec, planContactSheet, TILE_WIDTH } from "./contact-sheet";

describe("beatSec", () => {
  it("takes the midpoint of an ordinary shot", () => {
    expect(beatSec({ startSec: 3.466667, durationSec: 2.3 }, 30)).toBeCloseTo(4.616667, 6);
  });

  it("never lands past the shot's last frame", () => {
    // 1.2 frames long: the midpoint (0.6 frame) is fine, but the clamp must hold
    // the beat at or before start + duration - 1 frame.
    const entry = { startSec: 10, durationSec: 1.2 / 30 };
    const at = beatSec(entry, 30);
    expect(at).toBeGreaterThanOrEqual(entry.startSec);
    expect(at).toBeLessThanOrEqual(entry.startSec + entry.durationSec - 1 / 30 + 1e-6);
  });

  it("falls back to the shot's first frame when the shot is shorter than one frame", () => {
    expect(beatSec({ startSec: 7, durationSec: 0.01 }, 30)).toBe(7);
  });
});

describe("planContactSheet", () => {
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ shotId: `shot-${i}`, startSec: i * 2, durationSec: 2 }));

  it("tiles landscape deliverables four across, in timeline order", () => {
    const p = planContactSheet(entries(5), 30, { width: 1920, height: 1080 });
    expect({ columns: p.columns, rows: p.rows }).toEqual({ columns: 4, rows: 2 });
    expect(p.tile).toEqual({ width: TILE_WIDTH, height: 270 });
    expect({ width: p.width, height: p.height }).toEqual({ width: 1960, height: 564 });
    expect(p.stills.map((s) => s.shotId)).toEqual(["shot-0", "shot-1", "shot-2", "shot-3", "shot-4"]);
    expect(p.stills.map((s) => s.atSec)).toEqual([1, 3, 5, 7, 9]);
  });

  it("tiles portrait deliverables six across with an even tile height", () => {
    const p = planContactSheet(entries(7), 30, { width: 1080, height: 1920 });
    expect({ columns: p.columns, rows: p.rows }).toEqual({ columns: 6, rows: 2 });
    expect(p.tile.height % 2).toBe(0);
    expect(p.tile.height).toBe(854);
  });

  it("uses no more columns than there are shots", () => {
    const p = planContactSheet(entries(2), 30, { width: 1280, height: 720 });
    expect({ columns: p.columns, rows: p.rows }).toEqual({ columns: 2, rows: 1 });
  });

  it("names still files by index so operator shot ids never reach a path", () => {
    const p = planContactSheet(
      [{ shotId: "../../etc/'x'", startSec: 0, durationSec: 2 }],
      30,
      { width: 1280, height: 720 },
    );
    expect(p.stills[0]!.path).toBe("contact-sheet/still_000.png");
  });

  it("refuses an empty timeline instead of planning an empty sheet", () => {
    expect(() => planContactSheet([], 30, { width: 1280, height: 720 })).toThrow(/at least one/);
  });
});
