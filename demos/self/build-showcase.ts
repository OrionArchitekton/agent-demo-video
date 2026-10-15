import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The render report fields the showcase reads. Everything else in the report is ignored. */
export type ReportLike = {
  ttsMode?: string;
  /** Digest of the script the render used, so the checks can be tied to that script. */
  scriptSha256?: string;
  hook?: string;
  transcriptCheck?: { ran: true; droppedPhrases: string[] } | { ran: false; reason: string };
  deliverable?: { ok: boolean; problems: string[] };
  motionCards?: { renderer: string; version: string };
};

export type ShowcaseInputs = { script: string; runLog: string; report: ReportLike; version: string };
export type Check = { testid: string; label: string; value: string };

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A path starts after a non-path character and ends at "/", whitespace, a quote or end of text.
const START = "(?<![\\w.~/-])";
// A path ends at a separator, whitespace, a quote or bracket, list punctuation, or a sentence-final
// period; a period followed by more path characters ("/home/u.old") is part of the path.
const END = "(?=$|[/\\s'\"`:,;)\\]}>]|\\.(?:\\s|$))";

function replacePath(text: string, path: string, to: string): string {
  const p = path.replace(/\/+$/, "");
  if (!p) return text;
  return text.replace(new RegExp(`${START}${escapeRe(p)}${END}`, "g"), () => to);
}

/**
 * Replace machine-specific absolute paths so a committed log names no one's directories.
 * Whole paths only, repo root before home (the root usually lives under home), and any path
 * under the system temp directory collapses to its last segment.
 */
export function sanitizeLog(text: string, repoRoot: string, home: string): string {
  // eslint-disable-next-line no-control-regex
  let out = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  out = replacePath(out, repoRoot, ".");
  out = replacePath(out, home, "~");
  const temps = [...new Set([tmpdir().replace(/\/+$/, ""), "/tmp"])].filter(Boolean).sort((x, y) => y.length - x.length);
  const re = new RegExp(`${START}(?:${temps.map(escapeRe).join("|")})(?:/[^\\s'"]*)?(?=$|[\\s'"])`, "g");
  return out.replace(re, (m) => {
    const last = m.replace(/\/+$/, "").split("/").pop() ?? "";
    return temps.includes(m.replace(/\/+$/, "")) ? "<tmp>" : `<tmp>/${last}`;
  });
}

/** The only reasons the tool itself writes for a transcript check that did not run. */
const FIXED_REASONS = ["no voice.aligner configured", "FAKE_TTS: narration is silent", "aligner wrote no word timings"];
const KNOWN_PREFIXES = ["aligner failed", "script too long to compare"];

/**
 * Never copy aligner output. A failure reason can carry the aligner program or its error text,
 * which is private voice setup, so anything but a fixed reason is cut at its first colon.
 */
function trimTranscriptCheck(t: any, script: string | undefined): ReportLike["transcriptCheck"] {
  // Dropped phrases come from the script, so only text the script really contains is kept.
  if (t.ran === true) {
    return {
      ran: true,
      droppedPhrases: (t.droppedPhrases as string[]).map((p) => (script && p && script.includes(p) ? p : "(phrase not shown)")),
    };
  }
  const reason = String(t.reason ?? "");
  if (FIXED_REASONS.includes(reason)) return { ran: false, reason };
  // Unknown text may carry a program path, a host or a token before its colon, so only the CLI's
  // own known prefixes survive; anything else becomes a fixed phrase.
  const known = KNOWN_PREFIXES.find((p) => reason === p || reason.startsWith(`${p}:`));
  return { ran: false, reason: known ?? "transcript check did not run" };
}

/**
 * Only the report fields the showcase reads. The full report records the voice setup exactly as
 * configured, which must never be committed, so assets are always written through this.
 */
export function trimReport(r: Record<string, any>, script?: string): ReportLike {
  const out: ReportLike = {};
  if (r.ttsMode !== undefined) out.ttsMode = r.ttsMode;
  if (r.inputs?.scriptSha256 !== undefined) out.scriptSha256 = r.inputs.scriptSha256;
  if (r.hook !== undefined) out.hook = r.hook;
  if (r.transcriptCheck !== undefined) out.transcriptCheck = trimTranscriptCheck(r.transcriptCheck, script);
  // Problem text can name files on the rendering machine; the showcase only needs the count.
  if (r.deliverable !== undefined) {
    out.deliverable = { ok: r.deliverable.ok, problems: (r.deliverable.problems ?? []).map(() => "(problem not shown)") };
  }
  if (r.motionCards !== undefined) out.motionCards = { renderer: r.motionCards.renderer, version: r.motionCards.version };
  return out;
}

/** The sanitized run log and the trimmed, sanitized report text, ready to commit. */
export function refreshTexts(i: { log: string; reportJson: string; repoRoot: string; home: string; script?: string }): {
  log: string;
  report: string;
} {
  const clean = (t: string): string => sanitizeLog(t, i.repoRoot, i.home).replace(/[\u2013\u2014\u2015]/g, "-");
  const report = trimReport(JSON.parse(i.reportJson) as Record<string, unknown>, i.script);
  return { log: clean(i.log), report: clean(JSON.stringify(report, null, 2)) + "\n" };
}

export type CliMode = { mode: "build" } | { mode: "refresh"; outDir: string; logFile: string };

export function parseRefreshArgs(args: string[]): CliMode {
  if (args.length === 0) return { mode: "build" };
  if (args[0] === "--refresh" && args.length === 3) return { mode: "refresh", outDir: args[1]!, logFile: args[2]! };
  throw new Error("usage: build-showcase.ts [--refresh <out-dir> <log-file>]");
}

export function checksFrom(r: ReportLike): Check[] {
  const t = r.transcriptCheck;
  const transcript = !t
    ? "not recorded"
    : t.ran
      ? t.droppedPhrases.length === 0
        ? "every scripted phrase was heard"
        : `${t.droppedPhrases.length} ${t.droppedPhrases.length === 1 ? "phrase" : "phrases"} missing`
      : `not run (${t.reason})`;
  return [
    { testid: "check-transcript", label: "Transcript check", value: transcript },
    { testid: "check-hook", label: "Hook on the first frame", value: r.hook === undefined ? "not recorded" : r.hook === "set" || r.hook === "missing" ? r.hook : "unknown" },
    {
      testid: "check-deliverable",
      label: "Video file verified",
      value: r.deliverable ? (r.deliverable.ok ? "passed" : `${r.deliverable.problems.length} ${r.deliverable.problems.length === 1 ? "problem" : "problems"}`) : "not recorded",
    },
    {
      testid: "check-motion",
      label: "Motion cards",
      value: r.motionCards ? `${r.motionCards.renderer} ${r.motionCards.version}` : "off",
    },
    {
      testid: "check-voice",
      label: "Narration",
      value: r.ttsMode === undefined ? "not recorded" : r.ttsMode === "real" ? "voiced" : r.ttsMode === "fake" ? "silent draft" : "unknown",
    },
  ];
}

const CSS = `
:root { --bg: #0f1419; --panel: #182029; --ink: #e8edf2; --muted: #93a1b0; --accent: #4fb3a9; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 24px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
/* The tool frames the page as a window and burns captions over its lower part, so every view
   keeps its content in the upper part of the viewport. */
section { display: none; max-width: 1500px; margin: 40px auto 0; padding: 0 48px; }
section:target { display: block; }
body:not(:has(section:target)) #script { display: block; }
h2 { font-size: 48px; margin: 0 0 6px; }
.sub { color: var(--muted); margin: 0 0 22px; font-size: 24px; }
pre { margin: 0; padding: 24px 30px; background: var(--panel); border-radius: 14px; font: 21px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; white-space: pre-wrap; }
#script pre { column-count: 2; column-gap: 48px; }
#run pre { font-size: 24px; line-height: 1.4; }
#run pre .line { display: block; min-height: 1.4em; opacity: 0; animation: show 0.2s ease forwards; }
@keyframes show { to { opacity: 1; } }
#install { margin-top: 70px; }
#install pre { font-size: 34px; line-height: 1.6; margin-bottom: 32px; }
#install .sub { font-size: 30px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.card { background: var(--panel); border-radius: 14px; padding: 16px 24px; }
.card .label { color: var(--muted); font-size: 20px; }
.card .value { font-size: 28px; font-weight: 700; color: var(--accent); }
img.sheet { display: block; margin: 0 auto; max-width: 100%; max-height: 36vh; border-radius: 14px; }
`;

const MAX_LINES = 24;
const LEAD_IN_SEC = 1.5;
const REPLAY_SEC = 7;

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * The part of the script the page shows: everything before shot `shown + 1`, verbatim, then one
 * line naming the shots left out. Built from the script so it cannot drift from it.
 */
export function scriptExcerpt(
  script: string,
  shown = 3,
): { shown: string; remaining: string[]; text: string } {
  const heads = [...script.matchAll(/^### SHOT (\S+)/gm)];
  const body = (t: string): string => t.replace(/\s+$/, "");
  if (heads.length <= shown) return { shown: body(script), remaining: [], text: body(script) };
  const head = body(script.slice(0, heads[shown]!.index));
  const remaining = heads.slice(shown).map((m) => m[1]!);
  const n = remaining.length;
  const line = `(and ${NUMBER_WORDS[n] ?? String(n)} more shot${n === 1 ? "" : "s"}: ${remaining.join(", ")})`;
  return { shown: head, remaining, text: `${head}\n\n${line}` };
}

export function buildShowcase(i: ShowcaseInputs): string {
  const all = i.runLog.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
  const lines = all.slice(-MAX_LINES);
  const truncated = all.length > MAX_LINES;
  // The animation starts at page load, before recording settles, so lead in; then spread the lines.
  const step = REPLAY_SEC / Math.max(1, lines.length);
  const run = lines
    .map((l, n) => `<span class="line" style="animation-delay:${(LEAD_IN_SEC + n * step).toFixed(2)}s">${esc(l)}</span>`)
    .join("");
  const cards = checksFrom(i.report)
    .map((c) => `<div class="card" data-testid="${c.testid}"><div class="label">${esc(c.label)}</div><div class="value">${esc(c.value)}</div></div>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>agent-demo-video: how this video was made</title>
<!-- Generated by demos/self/build-showcase.ts. Do not edit by hand. -->
<style>${CSS}</style>
</head>
<body>
<section id="script">
<h2>The script</h2>
<p class="sub">Every shot: a heading, one line of narration, and the clicks to perform.</p>
<pre data-testid="script-text">${esc(scriptExcerpt(i.script).text)}</pre>
</section>
<section id="run">
<h2>The run</h2>
<p class="sub">A real run of this script, replayed${truncated ? " (the last 24 lines)" : ""}. Notices are the tool explaining what it adjusted.</p>
<pre data-testid="run-log">${run}</pre>
</section>
<section id="checks">
<h2>The checks</h2>
<p class="sub">From the render report and contact sheet of an earlier render of this script.</p>
<div class="cards">
${cards}
</div>
<img class="sheet" data-testid="contact-sheet" src="assets/contact-sheet.png" alt="Contact sheet: one still per segment">
</section>
<section id="install">
<h2>Make one for your app</h2>
<p class="sub">In Claude Code:</p>
<pre data-testid="install-plugin">/plugin marketplace add OrionArchitekton/agent-demo-video
/plugin install agent-demo-video@agent-demo-video</pre>
<p class="sub">Or from a terminal:</p>
<pre data-testid="install-npx">npx -y agent-demo-video@${esc(i.version)} demo.config.json</pre>
</section>
</body>
</html>
`;
}

/** The repository root, from this module's own location (demos/self/ is two levels down). */
export const repoRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Inputs as committed in the repository. */
export function committedInputs(root: string = repoRoot()): ShowcaseInputs {
  const r = (p: string) => readFileSync(resolve(root, p), "utf8");
  return {
    script: r("demos/self/DEMO_SCRIPT.md"),
    runLog: r("demos/self/assets/run.log"),
    report: JSON.parse(r("demos/self/assets/report.json")) as ReportLike,
    version: (JSON.parse(r("package.json")) as { version: string }).version,
  };
}

function main(args: string[]): void {
  const mode = parseRefreshArgs(args);
  const root = repoRoot();
  if (mode.mode === "refresh") {
    const assets = resolve(root, "demos/self/assets");
    mkdirSync(assets, { recursive: true });
    const out = refreshTexts({
      log: readFileSync(resolve(mode.logFile), "utf8"),
      reportJson: readFileSync(resolve(mode.outDir, "render-report.json"), "utf8"),
      repoRoot: root,
      home: homedir(),
      script: readFileSync(resolve(root, "demos/self/DEMO_SCRIPT.md"), "utf8"),
    });
    // Convert the contact sheet first: if ffmpeg fails, nothing in assets/ has changed yet.
    const nextSheet = resolve(assets, "contact-sheet.next.png");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", resolve(mode.outDir, "contact-sheet.png"), "-vf", "scale=1280:-2", nextSheet]);
    writeFileSync(resolve(assets, "run.log"), out.log);
    writeFileSync(resolve(assets, "report.json"), out.report);
    renameSync(nextSheet, resolve(assets, "contact-sheet.png"));
    console.log("refreshed demos/self/assets");
  }
  writeFileSync(resolve(root, "demos/self/showcase.html"), buildShowcase(committedInputs(root)));
  console.log("wrote demos/self/showcase.html");
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
