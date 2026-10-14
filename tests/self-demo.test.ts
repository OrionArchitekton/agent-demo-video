import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { parseScript } from "../src/parse-script";
import { resolveSelectorFindings, structuralFindings } from "../src/preflight";
import { findPrivateStrings } from "./support/distribution";
import { buildShowcase, checksFrom, committedInputs, sanitizeLog } from "../demos/self/build-showcase";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("self-demo preflight", () => {
  it("every shot passes the selector gate offline with no finding at all", async () => {
    const cfg = loadConfig("demos/self/demo.config.json");
    const manifest = parseScript(read(cfg.script));
    // Any finding at all fails: a typo in a selector after a click is only "unverified", not blocking.
    const findings = [...structuralFindings(manifest, cfg), ...(await resolveSelectorFindings(manifest, cfg))];
    expect(findings, JSON.stringify(findings)).toEqual([]);
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
    expect(clean).toBe("wrote ./demos/self/out/final.mp4\nprofile ~/.cache/x\ntmp <tmp>/seg");
  });

  it("replaces whole paths only, at path boundaries", () => {
    const log = "a /home/u2/x\nb /home/u/x\nc /repo-old/x\nd /repo/x\ne '/home/u'\nf /home/u";
    expect(sanitizeLog(log, "/repo", "/home/u")).toBe("a /home/u2/x\nb ~/x\nc /repo-old/x\nd ./x\ne '~'\nf ~");
  });

  it("does the repo root before home when the root is under home", () => {
    expect(sanitizeLog("at /home/u/src/repo/out and /home/u/other", "/home/u/src/repo", "/home/u")).toBe(
      "at ./out and ~/other",
    );
  });

  it("ignores empty root or home arguments", () => {
    expect(sanitizeLog("keep /a/b", "", "")).toBe("keep /a/b");
  });

  it("collapses temp paths to their last segment and strips ANSI color codes", () => {
    const log = "\u001b[32m\u2713 wrote\u001b[0m /tmp/x/-home-user-/y/final.mp4\nscratch " + tmpdir() + "/a/b/seg.png";
    expect(sanitizeLog(log, "/repo", "/home/u")).toBe("\u2713 wrote <tmp>/final.mp4\nscratch <tmp>/seg.png");
    expect(sanitizeLog("/tmpfoo/x", "/repo", "/home/u")).toBe("/tmpfoo/x");
  });

  it("uses singular wording and does not claim a hook that was not recorded", () => {
    expect(checksFrom({ ...report, transcriptCheck: { ran: true, droppedPhrases: ["a"] } })[0]!.value).toBe("1 phrase missing");
    expect(checksFrom({ ...report, deliverable: { ok: false, problems: ["p"] } })[2]!.value).toBe("1 problem");
    const { hook: _h, ...noHook } = report;
    expect(checksFrom(noHook)[1]!.value).toBe("not recorded");
    expect(checksFrom({ ...report, hook: "missing" })[1]!.value).toBe("missing");
  });

  it("replays with a lead-in, within about 7 seconds, the last 24 lines only", () => {
    const log = Array.from({ length: 30 }, (_, n) => `l${n}`).join("\n");
    const html = buildShowcase({ script: "s", runLog: log, report, version: "0.3.0" });
    expect(html).not.toContain(">l5<");
    expect(html).toContain(">l6<");
    expect(html).toContain("the last 24 lines");
    const delays = [...html.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(delays).toHaveLength(24);
    expect(delays[0]).toBeGreaterThanOrEqual(1.5);
    expect(delays[23]!).toBeLessThanOrEqual(8.6);
    const short = buildShowcase({ script: "s", runLog: "a\n\nb", report, version: "0.3.0" });
    expect(short).not.toContain("the last 24 lines");
  });

  it("sets the script smaller so all seven shots fit one frame", () => {
    const html = buildShowcase({ script: "s", runLog: "x", report, version: "0.3.0" });
    expect(html).toMatch(/#script pre \{[^}]*font-size: 17px/);
  });

  it("shows the script view when opened with no hash", () => {
    const html = buildShowcase({ script: "s", runLog: "x", report, version: "0.3.0" });
    expect(html).toContain("body:not(:has(section:target)) #script { display: block; }");
  });
});

describe("self-demo files", () => {
  it("the committed showcase is exactly what the generator builds", () => {
    expect(read("demos/self/showcase.html")).toBe(buildShowcase(committedInputs()));
    expect(read("demos/self/showcase.html")).toBe(buildShowcase(committedInputs(root)));
  });

  it("the run log and report name no absolute paths", () => {
    for (const f of ["demos/self/assets/run.log", "demos/self/assets/report.json"]) {
      const body = read(f);
      expect(findPrivateStrings(body), f).toEqual([]);
      expect(body, f).not.toMatch(/(^|[\s"'(=])\/(home|Users|tmp|mnt|root|var)\//m);
    }
  });

  it("both pages work offline", () => {
    for (const f of ["demos/self/app.html", "demos/self/showcase.html"]) {
      const body = read(f);
      expect(body, f).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\//i);
      expect(body, f).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//i);
    }
  });

  it("the contact sheet asset is small enough to commit", () => {
    const p = resolve(root, "demos/self/assets/contact-sheet.png");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeLessThanOrEqual(600 * 1024);
  });

  it("has seven shots in order", () => {
    const ids = [...read("demos/self/DEMO_SCRIPT.md").matchAll(/^### SHOT (\S+)/gm)].map((m) => m[1]);
    expect(ids).toEqual(["checklist", "name-release", "ship", "script", "run", "checks", "install"]);
  });
});
