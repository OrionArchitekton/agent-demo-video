import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { parseScript } from "../src/parse-script";
import { resolveSelectorFindings, structuralFindings } from "../src/preflight";
import { buildShowcase, checksFrom, sanitizeLog } from "../demos/self/build-showcase";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("self-demo preflight", () => {
  it("every shot passes the selector gate offline with no blocking finding", async () => {
    const cfg = loadConfig("demos/self/demo.config.json");
    const manifest = parseScript(read(cfg.script));
    const structural = structuralFindings(manifest, cfg).filter((f) => f.severity === "blocking");
    expect(structural, JSON.stringify(structural)).toEqual([]);
    const selectors = (await resolveSelectorFindings(manifest, cfg)).filter((f) => f.severity === "blocking");
    expect(selectors, JSON.stringify(selectors)).toEqual([]);
    expect(manifest.shots.length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});

describe("showcase generator", () => {
  const report = {
    ttsMode: "real",
    totalSec: 112.4,
    segments: 9,
    hook: "set",
    transcriptCheck: { ran: true as const, droppedPhrases: [] as string[] },
    deliverable: { ok: true, problems: [] as string[] },
    motionCards: { renderer: "hyperframes", version: "0.8.155" },
    contactSheet: { stills: [{ shotId: "__card-title" }, { shotId: "checklist" }] },
  };

  it("shows the script verbatim, escaped", () => {
    const html = buildShowcase({ script: "### SHOT a\n- narration: <b>&", runLog: "x", report, version: "0.3.0" });
    expect(html).toContain("### SHOT a\n- narration: &lt;b&gt;&amp;");
    expect(html).toContain('id="script"');
  });

  it("replays the run log one line at a time, escaped", () => {
    const html = buildShowcase({ script: "s", runLog: "one\n<two>", report, version: "0.3.0" });
    expect(html).toMatch(/<span class="line"[^>]*>one<\/span>/);
    expect(html).toMatch(/<span class="line"[^>]*>&lt;two&gt;<\/span>/);
  });

  it("derives the checks from the report", () => {
    const checks = checksFrom(report);
    expect(checks.map((c) => c.testid)).toEqual([
      "check-transcript",
      "check-hook",
      "check-deliverable",
      "check-motion",
      "check-voice",
    ]);
    expect(checks[0]!.value).toBe("every scripted phrase was heard");
    expect(checksFrom({ ...report, transcriptCheck: { ran: true, droppedPhrases: ["a", "b"] } })[0]!.value).toBe(
      "2 phrases missing",
    );
    expect(checksFrom({ ...report, transcriptCheck: { ran: false, reason: "dry run" } })[0]!.value).toBe(
      "not run (dry run)",
    );
  });

  it("pins the install line to the package version", () => {
    const html = buildShowcase({ script: "s", runLog: "x", report, version: "9.9.9" });
    expect(html).toContain("/plugin marketplace add OrionArchitekton/agent-demo-video");
    expect(html).toContain("npx -y agent-demo-video@9.9.9 demo.config.json");
  });

  it("sanitizes absolute paths in a run log", () => {
    const log = "wrote /repo/root/demos/self/out/final.mp4\nprofile /home/someone/.cache/x\ntmp /tmp/abc/seg";
    const clean = sanitizeLog(log, "/repo/root", "/home/someone");
    expect(clean).toBe("wrote ./demos/self/out/final.mp4\nprofile ~/.cache/x\ntmp <tmp>/abc/seg");
  });
});
