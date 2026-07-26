import { describe, it, expect } from "vitest";
import { structuralFindings } from "./preflight";
import { DemoConfigSchema, ManifestSchema } from "./types";

const manifest = (shots: unknown[]) => ManifestSchema.parse({ shots });
const cfg = () => DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });

describe("structuralFindings", () => {
  // captureShot builds a FRESH browser context per shot and closes it after.
  // Nothing carries between shots, so a shot that references a selector but
  // never navigates for itself runs against about:blank, where every locator
  // waits out its full timeout mid-render. That is invisible until the render.
  it("flags a browser-driven shot that uses a selector but never navigates", () => {
    const f = structuralFindings(
      manifest([
        {
          id: "no-goto",
          target: "dashboard",
          narration: "n",
          actions: [{ kind: "highlight", selector: "#thing" }],
        },
      ]),
      cfg(),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.shotId).toBe("no-goto");
    expect(f[0]!.kind).toBe("no-navigation");
    expect(f[0]!.message).toMatch(/about:blank/);
  });

  // captureShot short-circuits a prebaked shot before runActions, so selector
  // actions on one are dead declarations: they read as instructions and do
  // nothing. Reported as their own kind, NOT as no-navigation, because a
  // prebaked shot is not supposed to navigate.
  it("flags a prebaked shot whose selector actions capture will never run", () => {
    const f = structuralFindings(
      manifest([
        {
          id: "clip-shot",
          target: "prebaked",
          clip: "x.mp4",
          narration: "n",
          actions: [{ kind: "highlight", selector: "#thing" }],
        },
      ]),
      cfg(),
    );
    // The nonexistent clip is ALSO a finding now, and both are correct: the
    // actions are dead AND the clip is missing. Assert the one under test.
    expect(f.map((x) => x.kind).sort()).toEqual(["missing-clip", "prebaked-actions"]);
  });

  // A prebaked shot with NO clip declared at all is just as decidable here as a
  // clip that is declared but absent, and capture throws on it either way. It
  // previously slipped through the `if (shot.clip)` guard, so every narration
  // was synthesized before the run died.
  it("flags a prebaked shot that declares no clip at all", () => {
    const f = structuralFindings(
      manifest([{ id: "no-clip", target: "prebaked", narration: "n", actions: [] }]),
      cfg(),
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe("missing-clip");
    expect(f[0]!.severity).toBe("blocking");
  });
});
