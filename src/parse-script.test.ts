import { describe, it, expect } from "vitest";
import { parseScript } from "./parse-script";

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
