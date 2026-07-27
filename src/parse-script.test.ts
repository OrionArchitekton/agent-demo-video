import { describe, it, expect } from "vitest";
import { parseScript, deriveSegmentKinds } from "./parse-script";

const md = `# Demo
### SHOT intro
- target: dashboard
- url: /
- narration: Welcome to Proctor.
- action: goto url="/"
- action: click selector="#bootstrap" label="Bootstrap"

### SHOT regress
- target: dashboard
- narration: We inject a regression.
- action: click selector="#degraded"
`;

describe("parseScript", () => {
  it("parses shots, narration, and actions", () => {
    const m = parseScript(md);
    expect(m.shots.map(s => s.id)).toEqual(["intro", "regress"]);
    expect(m.shots[0]!.narration).toBe("Welcome to Proctor.");
    expect(m.shots[0]!.actions[1]).toMatchObject({ kind: "click", selector: "#bootstrap", label: "Bootstrap" });
    expect(m.shots[1]!.actions[0]).toMatchObject({ kind: "click", selector: "#degraded" });
  });
});

describe("scroll action", () => {
  it("parses scroll with a selector and scroll with a y offset", async () => {
    const { parseScript } = await import("./parse-script");
    const md = [
      "### SHOT s1",
      "- narration: n",
      '- action: scroll selector="#target"',
      "- action: scroll y=500",
    ].join("\n");
    const m = parseScript(md);
    expect(m.shots[0]!.actions[0]).toMatchObject({ kind: "scroll", selector: "#target" });
    expect(m.shots[0]!.actions[1]).toMatchObject({ kind: "scroll", y: 500 });
  });
});

describe("demos/smoke assets stay valid", () => {
  it("parses and schema-validates the smoke fixture script and config", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseScript } = await import("./parse-script");
    const { loadConfig } = await import("./config");
    const m = parseScript(readFileSync("demos/smoke/DEMO_SCRIPT.md", "utf8"));
    expect(m.shots.length).toBeGreaterThanOrEqual(3);
    const cfg = loadConfig("demos/smoke/demo.config.json");
    expect(cfg.capture.engine).toBe("screencast");
  });
});

describe("fullBleed shots", () => {
  it("parses fullBleed and derives a segment kind that skips the window framing", () => {
    const md = [
      "### SHOT card",
      "- target: prebaked",
      "- clip: clips/title.mp4",
      "- fullBleed: true",
      "- narration: A finished composition.",
      "",
      "### SHOT app",
      "- target: dashboard",
      "- narration: A real app recording.",
      "- action: goto url=\"/\"",
    ].join("\n");
    const m = parseScript(md);
    expect(m.shots[0]?.fullBleed).toBe(true);
    expect(m.shots[1]?.fullBleed).toBeUndefined();
    // A motion-graphic clip is already composed, so it must not be re-framed as a
    // floating window; an app recording still gets the frame treatment.
    expect(deriveSegmentKinds(m.shots)).toEqual(["card", "shot"]);
  });
});

describe("fullBleed parsing is fail-closed", () => {
  const shot = (line: string) => `### SHOT s\n- target: prebaked\n- clip: c.mp4\n${line}\n- narration: n.`;

  it("accepts the spellings an author actually types", () => {
    for (const l of ["- fullBleed: true", "- fullBleed:true", "- fullbleed: TRUE", "- fullBleed: yes", "- fullBleed: true   "]) {
      expect(parseScript(shot(l)).shots[0]?.fullBleed, l).toBe(true);
    }
    for (const l of ["- fullBleed: false", "- fullBleed: no"]) {
      expect(parseScript(shot(l)).shots[0]?.fullBleed, l).toBeFalsy();
    }
  });

  it("REFUSES an unrecognised value instead of silently ignoring the line", () => {
    // Silently dropping this is the exact defect the flag exists to prevent:
    // the author believes they opted out of framing and the pipeline frames anyway.
    expect(() => parseScript(shot("- fullBleed: maybe"))).toThrowError(/fullBleed/i);
  });
});
