import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The render report fields the showcase reads. Everything else in the report is ignored. */
export type ReportLike = {
  ttsMode?: string;
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
const END = "(?=$|[/\\s'\"])";

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
    { testid: "check-hook", label: "Hook on the first frame", value: r.hook === undefined ? "not recorded" : r.hook === "missing" ? "missing" : "set" },
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
    { testid: "check-voice", label: "Narration", value: r.ttsMode === "real" ? "voiced" : "silent draft" },
  ];
}

const CSS = `
:root { --bg: #0f1419; --panel: #182029; --ink: #e8edf2; --muted: #93a1b0; --accent: #4fb3a9; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 22px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
section { display: none; max-width: 1500px; margin: 56px auto; padding: 0 48px; }
section:target { display: block; }
body:not(:has(section:target)) #script { display: block; }
h2 { font-size: 44px; margin: 0 0 8px; }
.sub { color: var(--muted); margin: 0 0 28px; }
pre { margin: 0; padding: 28px 32px; background: var(--panel); border-radius: 14px; font: 21px/1.55 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; white-space: pre-wrap; }
#script pre { font-size: 17px; line-height: 1.4; padding: 20px 28px; }
#run pre .line { display: block; min-height: 1.55em; opacity: 0; animation: show 0.2s ease forwards; }
@keyframes show { to { opacity: 1; } }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 28px; }
.card { background: var(--panel); border-radius: 14px; padding: 22px 26px; }
.card .label { color: var(--muted); font-size: 18px; }
.card .value { font-size: 28px; font-weight: 700; color: var(--accent); }
img.sheet { width: 100%; border-radius: 14px; }
`;

const MAX_LINES = 24;
const LEAD_IN_SEC = 1.5;
const REPLAY_SEC = 7;

export function buildShowcase(i: ShowcaseInputs): string {
  const all = i.runLog.replace(/\n+$/, "").split("\n");
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
<pre data-testid="script-text">${esc(i.script)}</pre>
</section>
<section id="run">
<h2>The run</h2>
<p class="sub">A real run of this script, replayed${truncated ? " (the last 24 lines)" : ""}.</p>
<pre data-testid="run-log">${run}</pre>
</section>
<section id="checks">
<h2>The checks</h2>
<p class="sub">From the render report of this video's previous render.</p>
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

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = repoRoot();
  writeFileSync(resolve(root, "demos/self/showcase.html"), buildShowcase(committedInputs(root)));
  console.log("wrote demos/self/showcase.html");
}
