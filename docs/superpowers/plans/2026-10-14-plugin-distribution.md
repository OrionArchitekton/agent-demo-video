# Plugin Distribution (PR-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository installable as a Claude Code plugin (skill plus read-only reviewer agent), rewrite the README to lead with install and a first video, move reference material to guide pages, and prepare the 0.3.0 release without publishing anything.

**Architecture:** The repository root becomes both a Claude Code marketplace and its single plugin (`.claude-plugin/marketplace.json` with `source: "./"`, plus `.claude-plugin/plugin.json`). Plugin components live at the root in `skills/` and `agents/`; they are not part of the npm package. One new file-level test module (`tests/distribution.test.ts`) guards versions, frontmatter, links, private strings and long dashes. No CLI, schema or runtime dependency changes.

**Tech Stack:** TypeScript, vitest, Markdown, Claude Code plugin manifests, `claude plugin validate`.

Spec: `specs/plugin-distribution-spec.md` (scenarios 1 to 6; scenarios 7 to 9 are PR-B, planned separately after this merges).

**House rules for every task:**
- Public text (README, guide pages, skill, agent, manifests, runbook) uses no long dashes (U+2013, U+2014, U+2015). Rewrite the sentence; do not swap the character for a comma.
- Never write a home-directory path, a secret-manager command, a private host name or a personal email into any file.
- Run `pnpm test`, `pnpm typecheck` before each commit that touches TypeScript.
- Write scratch files under `<scratch>` (your scratch directory), never inside the repo.

---

## File structure

| Path | Responsibility |
|---|---|
| `.claude-plugin/plugin.json` | Plugin identity and version (create) |
| `.claude-plugin/marketplace.json` | The repo as a one-plugin marketplace (create) |
| `skills/demo-video/SKILL.md` | Teaches Claude the CLI, workflow order and voice choices (create) |
| `agents/render-reviewer.md` | Read-only pre-render reviewer (create) |
| `docs/guide/*.md` | Reference pages moved out of the README (create, 9 files) |
| `README.md` | Rewritten: what, install, quickstart, voice, features, CLI, docs (modify) |
| `CHANGELOG.md` | Fold the never-published "Unreleased" into 0.3.0 (modify) |
| `docs/runbooks/release.md` | Maintainer release steps (create) |
| `tests/distribution.test.ts` | Distribution checks (create, grows per task) |
| `tests/readme.smoke.test.ts` | Retarget to the guide pages (modify) |

Note on 0.3.0: `package.json` has said 0.3.0 since PR #11, but 0.3.0 was never published or tagged (npm and the latest GitHub release are 0.2.0). So everything under "Unreleased" ships as 0.3.0.

---

### Task 1: Plugin and marketplace manifests

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Test: `tests/distribution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/distribution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// vitest runs with cwd = repo root (see the other smoke tests).
const root = process.cwd();
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
const json = (p: string): any => JSON.parse(read(p));
const pkg = json("package.json") as { name: string; version: string };

describe("plugin and marketplace manifests", () => {
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");

  it("names the plugin after the package and carries the package version", () => {
    expect(plugin.name).toBe(pkg.name);
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.license).toBe("MIT");
    expect(plugin.repository).toBe("https://github.com/OrionArchitekton/agent-demo-video");
  });

  it("makes the repository a marketplace with exactly this plugin at its root", () => {
    expect(market.name).toBe(pkg.name);
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe(plugin.name);
    expect(market.plugins[0].source).toBe("./");
    expect(market.plugins[0].version).toBe(pkg.version);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/distribution.test.ts`
Expected: FAIL, `ENOENT ... .claude-plugin/plugin.json`.

- [ ] **Step 3: Create the manifests**

`.claude-plugin/plugin.json`:

```json
{
  "name": "agent-demo-video",
  "version": "0.3.0",
  "description": "Make narrated, captioned demo videos of web apps from a script, headless. Adds a demo-video skill and a read-only render-reviewer agent.",
  "author": {
    "name": "Dan Mercede",
    "url": "https://www.danmercede.com"
  },
  "homepage": "https://github.com/OrionArchitekton/agent-demo-video",
  "repository": "https://github.com/OrionArchitekton/agent-demo-video",
  "license": "MIT",
  "keywords": ["demo-video", "screencast", "playwright", "ffmpeg", "tts", "captions"]
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "agent-demo-video",
  "owner": {
    "name": "Dan Mercede",
    "url": "https://www.danmercede.com"
  },
  "metadata": {
    "description": "agent-demo-video for Claude Code: narrated, captioned demo videos of web apps."
  },
  "plugins": [
    {
      "name": "agent-demo-video",
      "source": "./",
      "description": "Make narrated, captioned demo videos of web apps from a script, headless.",
      "version": "0.3.0"
    }
  ]
}
```

- [ ] **Step 4: Run the test and the validator**

Run: `pnpm vitest run tests/distribution.test.ts`
Expected: PASS (2 tests).

Run: `claude plugin validate --strict .` and `claude plugin validate --strict .claude-plugin/plugin.json`
Expected: both print `Validation passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin tests/distribution.test.ts
git commit -m "feat: make the repository a Claude Code plugin marketplace"
```

---

### Task 2: Read-only render-reviewer agent

**Files:**
- Create: `agents/render-reviewer.md`
- Test: `tests/distribution.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Add this helper below the `pkg` line in `tests/distribution.test.ts`:

```ts
/** Flat `key: value` frontmatter of a Markdown file with a leading `---` block. */
export function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
```

Append:

```ts
describe("render-reviewer agent", () => {
  const md = read("agents/render-reviewer.md");
  const fm = frontmatter(md);

  it("is named render-reviewer and has only read-only tools", () => {
    expect(fm.name).toBe("render-reviewer");
    expect(fm.description?.length ?? 0).toBeGreaterThan(40);
    const tools = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(["Read", "Glob", "Grep"]).toContain(t);
  });

  it("returns a verdict and one line per flag with severity and shot", () => {
    expect(md).toContain("VERDICT: READY | FIX FIRST");
    expect(md).toContain("`SEVERITY | shot <id> | what is wrong | smallest fix`");
    expect(md).toContain("UNCHECKED");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/distribution.test.ts`
Expected: FAIL, `ENOENT ... agents/render-reviewer.md`.

- [ ] **Step 3: Create the agent**

`agents/render-reviewer.md`:

```markdown
---
name: render-reviewer
description: Use before spending a narrated render, to review an agent-demo-video render's contact sheet, first frame and script against its brief. Read-only; returns severity-graded flags and never edits.
tools: Read, Glob, Grep
model: sonnet
---

You are the render reviewer for agent-demo-video. You look at a silent-pass render before narration
is spent and return a short list of flags. You cannot edit anything, and you never rewrite the script
or redesign the video. The caller fixes only what you flag.

## Inputs

The caller gives paths. If one is missing, list it under UNCHECKED; never guess what you did not see.

- `contact-sheet.png`: one still per shot, taken at the shot's midpoint, tiled in shot order. Open it.
- `frame0.png`: the first frame of `final.mp4`. Without it, the first-frame check is UNCHECKED.
- `DEMO_SCRIPT.md`: the shots, their narration and actions.
- A one-line brief: what the video must show, for whom, and the platform (landscape or Shorts).

## Reading a contact sheet

Stills are taken mid-shot, so a caption showing part of a line is expected. Flag caption text only
when a word is misspelled or the text is illegible. Match stills to shots by order. If a defect
might sit between stills, say so under UNCHECKED and ask for the frame instead of guessing.

## Checks, in severity order

BLOCKING:
- The first frame does not show the hook (or, without a hook, the title) as large, legible text.
- Two text layers overlap in any still: a caption over a label, a title over app text, a chapter
  card over a highlight.
- Text is cut off at a frame edge, or, on a Short, sits in the platform UI zones (bottom fifth or
  top tenth of the 9:16 frame).
- A shot shows a blank page, an error page, a login wall or a loading spinner instead of the app.
- A shot contradicts its narration: the narration names a screen, button or value the still does
  not show.

WARNING:
- Two consecutive shots look the same, or a shot shows no visible change from the one before.
- Text too small to read at the target size (phone size for a Short).
- The end card is missing, or its URL is unreadable.

INFO: framing, color, spacing and pacing suggestions.

## Output (plain text, under 300 words)

VERDICT: READY | FIX FIRST
FINDINGS: one line each: `SEVERITY | shot <id> | what is wrong | smallest fix`
UNCHECKED: anything you could not see or verify (audio, motion between stills, missing inputs).

Never pad with praise. Never propose new shots or script lines; name the smallest change that
removes the defect.
```

- [ ] **Step 4: Run the test and the validator**

Run: `pnpm vitest run tests/distribution.test.ts` → PASS (4 tests).
Run: `claude plugin validate --strict .` → `Validation passed`.

- [ ] **Step 5: Commit**

```bash
git add agents/render-reviewer.md tests/distribution.test.ts
git commit -m "feat: read-only render-reviewer agent for the plugin"
```

---

### Task 3: The demo-video skill

**Files:**
- Create: `skills/demo-video/SKILL.md`
- Test: `tests/distribution.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe("demo-video skill", () => {
  const md = read("skills/demo-video/SKILL.md");
  const fm = frontmatter(md);

  it("has a when-to-use description", () => {
    expect(fm.name).toBe("demo-video");
    expect(fm.description).toMatch(/^Use when /);
  });

  it("names the prerequisites and runs the CLI pinned to the package version", () => {
    for (const s of ["Node 18", "ffmpeg", "ffprobe", "npx playwright install chromium"]) {
      expect(md).toContain(s);
    }
    expect(md).toContain(`npx -y agent-demo-video@${pkg.version} `);
    const pins = [...md.matchAll(/agent-demo-video@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(new Set(pins)).toEqual(new Set([pkg.version]));
  });

  it("sets the six-step order of work", () => {
    const steps = [
      "**Write the script and config.**",
      "**Preflight.**",
      "**Silent pass.**",
      "**Review.**",
      "**Narrated render.**",
      "**Read the report.**",
    ];
    const at = steps.map((s) => md.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(md).toContain("render-reviewer");
    expect(md).toContain("render-report.json");
  });

  it("explains the three voice choices", () => {
    expect(md).toContain("ELEVENLABS_API_KEY");
    expect(md).toContain('"provider": "command"');
    expect(md).toContain("FAKE_TTS=1");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/distribution.test.ts`
Expected: FAIL, `ENOENT ... skills/demo-video/SKILL.md`.

- [ ] **Step 3: Create the skill**

`skills/demo-video/SKILL.md`:

````markdown
---
name: demo-video
description: Use when the user wants a narrated, captioned demo video of a web app, a product walkthrough recording, or a launch or hackathon demo MP4, made headlessly from a script and a running app.
---

# Demo video with agent-demo-video

agent-demo-video turns a `DEMO_SCRIPT.md` and a running web app into a narrated, captioned MP4.
Narration is generated first and paces the recording and the captions, so all three stay in sync.
Everything runs headless from a config file.

## Prerequisites

Check these before the first render and tell the user what is missing:

- Node 18 or newer (`node --version`). Motion cards need Node 22.12 or newer.
- ffmpeg and ffprobe on `PATH` (`ffmpeg -version`).
- The capture browser, installed once: `npx playwright install chromium`.
- The app to record is running and reachable, or is a local folder of HTML files.

Run the CLI pinned to this plugin's version, from the directory that holds the config:

```bash
npx -y agent-demo-video@0.3.0 demo.config.json
```

## Workflow

Follow this order. Each step is cheap compared with the one after it.

1. **Write the script and config.** Read the app first (routes, the elements the demo will touch)
   and pick stable selectors: ids, `data-testid` attributes, labels. Keep each shot's narration to
   one or two plain sentences; the narration length sets the shot length.
2. **Preflight.** Every render starts with a fail-closed selector gate: each action's selector must
   match on the live app (a `highlight` must match exactly one element) before anything is
   generated. If the silent pass stops here, fix the selectors it names. Never pass
   `--no-preflight` to get past a failure.
3. **Silent pass.** `FAKE_TTS=1 npx -y agent-demo-video@0.3.0 demo.config.json` renders the whole
   video with silent narration of estimated length. It costs nothing.
4. **Review.** Extract the first frame
   (`ffmpeg -y -i out/final.mp4 -frames:v 1 out/frame0.png`) and dispatch the `render-reviewer`
   agent from this plugin with `out/contact-sheet.png`, `out/frame0.png`, the script and a one-line
   brief. Fix every BLOCKING flag and repeat the silent pass before going on.
5. **Narrated render.** Run again without `FAKE_TTS`, with the voice the user chose (below).
6. **Read the report.** Open `out/render-report.json`. Check `transcriptCheck` (phrases the
   narration did not say, present when an aligner is configured), `hook`, and the deliverable
   verification result. Look at `out/contact-sheet.png` once more, then give the user the path to
   `out/final.mp4`.

## Script format

Each shot is a `### SHOT <id>` heading followed by key-value lines and actions:

```markdown
### SHOT intro
- target: dashboard
- narration: This is the dashboard. Every active workflow, at a glance.
- action: goto url="/"
- action: highlight selector="#workflows"
- action: wait ms=800

### SHOT open-workflow
- target: dashboard
- narration: Click a workflow to open it in the editor.
- action: click selector="[data-testid=workflow-card]:first-child"
- action: wait ms=1200
```

Actions: `goto url`, `click selector`, `type selector text`, `hover selector`,
`highlight selector`, `scroll selector`, `chapter label`, `wait ms`. `goto` URLs are relative to
`dashboardBaseUrl`. Full reference:
https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/script-format.md

## Config

```json
{
  "script": "./DEMO_SCRIPT.md",
  "dashboardBaseUrl": "http://localhost:3000",
  "out": "out",
  "brand": { "title": "My App", "subtitle": "What it does, in one line", "url": "myapp.example" }
}
```

Options worth knowing:

- `"platform": "shorts"` renders a 9:16 video. Give Shorts a `brand.hook` (1 to 60 characters): it
  is large text on the first frame.
- `maxDurationSec` (default 300) fails the render if the video runs longer.
- `brand.motion: true` animates the title and end cards. It needs `npm install hyperframes@0.8.155`
  and Node 22.12 or newer.
- Shots behind a login use `target: live`; the user logs in once with
  `npx -y agent-demo-video@0.3.0 login demo.config.json`.

Full reference:
https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/config.md

## Voice

Ask the user which voice to use before the narrated render:

- **ElevenLabs.** Set `ELEVENLABS_API_KEY` in the environment. Without a key the run stops rather
  than shipping a silent video. Never write the key into a file or print it.
- **Their own text-to-speech.** Any program they can run from a shell:

  ```json
  "voice": {
    "provider": "command",
    "command": ["my-tts", "--text-file", "{text}", "--out", "{out}"]
  }
  ```

  `{text}` is a file holding the shot's narration and `{out}` is where the program writes audio.
  Add an `aligner` for word-timed captions and the transcript check:
  https://github.com/OrionArchitekton/agent-demo-video/blob/master/docs/guide/voice.md
- **Silent.** `FAKE_TTS=1`, for drafts only.

## Rules

- Never commit or print API keys or login profiles. The login profile lives outside the project.
- Fix a failing selector; never skip the preflight gate.
- Do not run the narrated render until the reviewer's BLOCKING flags are fixed.
````

- [ ] **Step 4: Run the test and the validator**

Run: `pnpm vitest run tests/distribution.test.ts` → PASS (8 tests).
Run: `claude plugin validate --strict .` → `Validation passed`.

- [ ] **Step 5: Commit**

```bash
git add skills/demo-video/SKILL.md tests/distribution.test.ts
git commit -m "feat: demo-video skill for the Claude Code plugin"
```

---

### Task 4: Private-string and long-dash scan over the plugin files

**Files:**
- Test: `tests/distribution.test.ts` (append)

- [ ] **Step 1: Write the scanner and its tests**

Append below the `frontmatter` helper:

```ts
// Shapes that only appear when a maintainer's private setup leaks into public files. Generic on
// purpose: this file is public too, so it names no private host, project or person.
const PRIVATE_PATTERNS: [string, RegExp][] = [
  ["secret-manager invocation", /\bdoppler\s+run\b/i],
  ["Linux home directory path", /\/home\/[a-z_][a-z0-9_-]*\//],
  ["macOS home directory path", /\/Users\/[A-Za-z][A-Za-z0-9._-]*\//],
  ["Windows home directory path", /[A-Za-z]:\\Users\\/],
  ["tailnet host name", /\.ts\.net\b/i],
  ["tailnet address", /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
  ["personal mail address", /[A-Za-z0-9._%+-]+@gmail\.com/i],
];

export function findPrivateStrings(text: string): string[] {
  return PRIVATE_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

// Built from code points so this source file holds no literal long dash.
const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014, 0x2015)}]`);

/** Repo-relative paths of every .md and .json file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(relative(root, p)));
    else if (/\.(md|json)$/.test(name)) out.push(relative(root, p));
  }
  return out.sort();
}

/** Files shipped to the public as documentation or plugin content. Grows as pages are added. */
function publicFiles(): string[] {
  return [...filesUnder(".claude-plugin"), ...filesUnder("skills"), ...filesUnder("agents")];
}
```

Append:

```ts
describe("public files carry nothing private and no long dashes", () => {
  it("the scanner catches planted private strings", () => {
    expect(findPrivateStrings("run: doppler run -p proj -c prd -- pnpm demo")).toContain(
      "secret-manager invocation",
    );
    expect(findPrivateStrings("see /home/someone/src/thing")).toContain("Linux home directory path");
    expect(findPrivateStrings("host box.tail1234.ts.net")).toContain("tailnet host name");
    expect(findPrivateStrings("at 100.80.1.2")).toContain("tailnet address");
    expect(findPrivateStrings("mail someone@gmail.com")).toContain("personal mail address");
    expect(findPrivateStrings("~/.cache/agent-demo-video and /path/to/venv")).toEqual([]);
  });

  it("the long-dash check catches a planted dash", () => {
    expect(LONG_DASH.test(`a ${String.fromCodePoint(0x2014)} b`)).toBe(true);
    expect(LONG_DASH.test("a - b, 8-10")).toBe(false);
  });

  it("scans every public file", () => {
    const files = publicFiles();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const body = read(f);
      expect(findPrivateStrings(body), f).toEqual([]);
      expect(LONG_DASH.test(body), `${f} has a long dash`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Prove the guard bites**

Temporarily append the line `doppler run -p x` to `skills/demo-video/SKILL.md`, run
`pnpm vitest run tests/distribution.test.ts`, and confirm `scans every public file` FAILS naming
`skills/demo-video/SKILL.md`. Remove the line (`git checkout -- skills/demo-video/SKILL.md` is safe
here because the file is committed and unchanged otherwise) and confirm PASS (11 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/distribution.test.ts
git commit -m "test: public files carry no private strings or long dashes"
```

---

### Task 5: Move reference material to guide pages

**Files:**
- Create: `docs/guide/pipeline.md`, `docs/guide/script-format.md`, `docs/guide/preflight.md`,
  `docs/guide/authenticated-capture.md`, `docs/guide/config.md`, `docs/guide/voice.md`,
  `docs/guide/third-party-tabs.md`, `docs/guide/quality-checks.md`, `docs/guide/motion-cards.md`
- Modify: `tests/readme.smoke.test.ts`, `tests/distribution.test.ts`
- `README.md` is NOT changed in this task (Task 6 replaces it).

- [ ] **Step 1: Write the failing tests**

In `tests/distribution.test.ts`, add the guide pages to `publicFiles()`:

```ts
function publicFiles(): string[] {
  return [
    ...filesUnder(".claude-plugin"),
    ...filesUnder("skills"),
    ...filesUnder("agents"),
    ...filesUnder("docs/guide"),
  ];
}
```

Add this helper below `filesUnder`:

```ts
/** Relative link targets in Markdown, anchor removed; skips URLs with a scheme and pure anchors. */
export function relativeLinks(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
    out.push(href.split("#")[0]!);
  }
  return out;
}

const GUIDE_PAGES = [
  "pipeline",
  "script-format",
  "preflight",
  "authenticated-capture",
  "config",
  "voice",
  "third-party-tabs",
  "quality-checks",
  "motion-cards",
].map((p) => `docs/guide/${p}.md`);
```

Append:

```ts
describe("guide pages", () => {
  it("all exist and every relative link in them resolves", () => {
    for (const page of GUIDE_PAGES) {
      expect(existsSync(resolve(root, page)), page).toBe(true);
      for (const href of relativeLinks(read(page))) {
        expect(existsSync(resolve(root, dirname(page), href)), `${page} -> ${href}`).toBe(true);
      }
    }
  });

  it("link to other guide pages, never to README anchors that moved", () => {
    for (const page of GUIDE_PAGES) {
      expect(read(page), page).not.toMatch(/\]\(#(authenticated-saas|quality-checks|motion-cards|pre-flight|third-party-tabs)/);
    }
  });
});
```

Replace the whole of `tests/readme.smoke.test.ts` with (same assertions, now on the guide pages
that hold the content):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("docs document auth-walled live capture", () => {
  const guide = page("docs/guide/authenticated-capture.md");

  it("documents the target: live mode and the login workflow", () => {
    expect(guide).toMatch(/target:\s*`?live/i);
    expect(guide).toMatch(/demo-video login/);
  });

  it("documents the auth-at-rest safety (profile outside the repo)", () => {
    expect(guide).toMatch(/\.cache\/agent-demo-video|outside the repo|at rest/i);
  });
});

describe("docs document the command voice aligner for an npm install", () => {
  const section = page("docs/guide/voice.md");

  it("shows the aligner by absolute paths, not a checkout-relative script", () => {
    expect(section).not.toMatch(/"tools\/align_whisper\.py"/);
    expect(section).toContain('"/path/to/venv/bin/python", "/path/to/agent-demo-video/tools/align_whisper.py"');
  });

  it("says where a global install puts the script and how to get faster-whisper", () => {
    expect(section).toContain("$(npm root -g)/agent-demo-video/tools/align_whisper.py");
    expect(section).toContain("python3 -m venv .venv && .venv/bin/pip install faster-whisper");
  });

  it("says command-written timings win and the aligner is then not run", () => {
    expect(section).toMatch(/they win and the aligner is not\s+run/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run tests/distribution.test.ts tests/readme.smoke.test.ts`
Expected: FAIL (guide pages missing).

- [ ] **Step 3: Extract each section verbatim**

The README at this branch's base (commit `f461b86`) has these sections. Extract each line range
into its page, then edit the page as described in Step 4:

```bash
mkdir -p docs/guide
git show f461b86:README.md > <scratch>/readme-base.md
x() { sed -n "$1,$2p" <scratch>/readme-base.md > "docs/guide/$3.md"; }
x 23 119 pipeline               # "## How it works" + Deliverable verification + Production polish + Capture engines
x 136 175 script-format          # "## DEMO_SCRIPT format"
x 176 272 preflight              # "## Pre-flight selector gate"
x 273 332 authenticated-capture  # "## Authenticated SaaS capture (`target: live`)"
x 333 370 config                 # "## Config"
x 371 420 voice                  # "## Use your own voice (command provider)"
x 421 474 third-party-tabs       # "## Third-party tabs"
x 475 515 quality-checks         # "## Quality checks"
x 516 558 motion-cards           # "## Motion cards"
```

Check each file starts on its `## ` heading and ends just before the next section
(`head -1 docs/guide/*.md`; `tail -3` each). Adjust a range by a line if a blank line or heading
is off.

- [ ] **Step 4: Edit each page**

For every page:
1. Promote headings one level: the first `## X` becomes `# X`, `### Y` becomes `## Y`, and so on.
   Do not touch `### SHOT` lines inside fenced code blocks.
2. Rewrite every sentence that contains a long dash (21 lines in the moved text carry one). Use a
   colon, a period and a new sentence, or parentheses, whichever reads naturally. In the
   `pipeline.md` diagram, replace the long dash between each step name and its description with
   a colon (`1. parseScript: parse shots and actions from Markdown`).
3. Fix links:
   - `(#authenticated-saas-capture-target-live)` → `(authenticated-capture.md)`
   - `(#quality-checks)` → `(quality-checks.md)`
   - `(#motion-cards)` → `(motion-cards.md)`
   - `(#pre-flight-selector-gate)` → `(preflight.md)`
   - `(#third-party-tabs)` → `(third-party-tabs.md)`
   - repo files gain `../../`: `(demos/factory-ai-at-work/gate-01/README.md)` →
     `(../../demos/factory-ai-at-work/gate-01/README.md)`; the `src/types.ts` mention in
     `config.md` becomes a link `[src/types.ts](../../src/types.ts)` or stays as code text.
   - In `config.md`, the sample line becomes "Sample: [`demo.config.sample.json`](../../demo.config.sample.json)."
4. Add `scroll selector` to the action table in `script-format.md` (it exists in the parser and
   the smoke demo but is missing from the table):
   `| \`scroll\` | \`selector\` | Smoothly scrolls the element into view |`
5. Add a one-line "Back to the [README](../../README.md)." at the end of each page.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/distribution.test.ts tests/readme.smoke.test.ts`
Expected: PASS. A failure names the page and the dash, link or private string to fix.

- [ ] **Step 6: Commit**

```bash
git add docs/guide tests/distribution.test.ts tests/readme.smoke.test.ts
git commit -m "docs: move README reference sections into guide pages"
```

---

### Task 6: Rewrite the README

**Files:**
- Modify: `README.md` (replace)
- Test: `tests/distribution.test.ts` (append, and add `README.md` to `publicFiles()`)

- [ ] **Step 1: Write the failing test**

Add `"README.md"` as the first entry of `publicFiles()`. Append:

```ts
describe("README leads with adoption", () => {
  const md = read("README.md");

  it("stays short", () => {
    expect(md.split("\n").length).toBeLessThanOrEqual(220);
  });

  it("opens with what it is, then install, then quickstart", () => {
    const install = md.indexOf("\n## Install");
    const quick = md.indexOf("\n## Quickstart");
    const features = md.indexOf("\n## Features");
    expect(install).toBeGreaterThan(md.indexOf("\n\n", md.indexOf("# agent-demo-video")));
    expect(quick).toBeGreaterThan(install);
    expect(features).toBeGreaterThan(quick);
  });

  it("gives three ways to install", () => {
    const section = md.slice(md.indexOf("\n## Install"), md.indexOf("\n## Quickstart"));
    expect(section).toContain("/plugin marketplace add OrionArchitekton/agent-demo-video");
    expect(section).toContain("/plugin install agent-demo-video@agent-demo-video");
    expect(section).toContain(`npx -y agent-demo-video@${pkg.version} `);
    expect(section).toContain("git clone https://github.com/OrionArchitekton/agent-demo-video.git");
  });

  it("has a keyless quickstart on the bundled smoke demo", () => {
    expect(md).toContain("FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json");
  });

  it("links every guide page and every relative link resolves", () => {
    const links = relativeLinks(md);
    for (const page of GUIDE_PAGES) expect(links, page).toContain(page);
    for (const href of links) expect(existsSync(resolve(root, href)), href).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/distribution.test.ts`
Expected: FAIL (README too long, missing install lines, and the private-string scan now flags the
old quickstart's secret-manager line).

- [ ] **Step 3: Replace `README.md`**

````markdown
# agent-demo-video

Turn a `DEMO_SCRIPT.md` and a running web app into a finished, narrated, captioned MP4, headless and
repeatable. Narration is generated first and becomes the clock for the screen recording and the
captions, so audio, video and captions stay in sync by construction. Length is capped by
`maxDurationSec` (default 300).

## Install

All three ways need Node 18 or newer and ffmpeg plus ffprobe on `PATH`
(`apt install ffmpeg` or `brew install ffmpeg`).

**Claude Code plugin.** Adds a `demo-video` skill that walks Claude through a video, and a
read-only `render-reviewer` agent that checks the contact sheet before narration is spent:

```text
/plugin marketplace add OrionArchitekton/agent-demo-video
/plugin install agent-demo-video@agent-demo-video
```

Then ask Claude for a demo video of your app. The skill runs the CLI through `npx`.

**npx or a global install:**

```bash
npx playwright install chromium                   # one time: the capture browser
npx -y agent-demo-video@0.3.0 demo.config.json
# or: npm install -g agent-demo-video, then: demo-video demo.config.json
```

**From source:**

```bash
git clone https://github.com/OrionArchitekton/agent-demo-video.git
cd agent-demo-video
pnpm install
pnpm exec playwright install chromium
```

## Quickstart

From a source checkout, render the bundled smoke demo with silent narration. It needs no API key
and no running app:

```bash
FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json
```

Output lands in `demos/smoke/out/`: `final.mp4`, `captions.srt`, `contact-sheet.png` and
`render-report.json`.

For your own app:

1. Write a `DEMO_SCRIPT.md`: one `### SHOT <id>` per shot, with narration and browser actions
   ([script format](docs/guide/script-format.md)).
2. Write a `demo.config.json` that points at the script and your running app
   ([config](docs/guide/config.md); sample: [`demo.config.sample.json`](demo.config.sample.json)).
3. Render with `FAKE_TTS=1` first and look at `contact-sheet.png`.
4. Choose a voice and render for real.

```markdown
### SHOT intro
- target: dashboard
- narration: This is the dashboard. Every active workflow, at a glance.
- action: goto url="/"
- action: highlight selector="#workflows"
- action: wait ms=800
```

## Voice

- **ElevenLabs.** Set `ELEVENLABS_API_KEY`. Without a key the run stops rather than shipping a
  silent video.
- **Your own text-to-speech.** `voice.provider: "command"` runs any program you can call from a
  shell, with an optional aligner for word-timed captions ([voice](docs/guide/voice.md)).
- **Silent.** `FAKE_TTS=1` renders placeholder narration of estimated length, for drafts.

## Features

- **Screencast capture** with an animated cursor, highlights, chapter cards, zoom on action, a
  slowly drifting camera, a framed scene and light sound design
  ([how the pipeline works](docs/guide/pipeline.md)).
- **Fail-closed preflight.** Every selector is checked on the live app before any narration is
  generated ([preflight](docs/guide/preflight.md)).
- **Apps behind a login.** `target: live` drives a saved browser profile kept outside the repo;
  `demo-video login <config.json>` creates it ([authenticated capture](docs/guide/authenticated-capture.md)).
- **Prebaked clips and third-party tabs** for surfaces you cannot or prefer not to automate
  ([third-party tabs](docs/guide/third-party-tabs.md)).
- **Shorts.** `"platform": "shorts"` renders 9:16, and `brand.hook` puts large text on the first
  frame ([config](docs/guide/config.md)).
- **Quality checks.** A transcript check compares what the video says with the script, and Shorts
  without a hook are flagged ([quality checks](docs/guide/quality-checks.md)).
- **Motion cards.** `brand.motion: true` animates the title and end cards with HyperFrames, an
  optional add-on ([motion cards](docs/guide/motion-cards.md)).
- **Verified output.** Every render probes the delivered `final.mp4` against the configured
  format, writes a `contact-sheet.png` with one still per shot, and records everything in
  `render-report.json`.

## CLI

```text
demo-video <config.json> [--no-preflight] [--out <new-directory>] [--script <absolute-file>]
                         [--clips-dir <absolute-directory>] [--render-host <host>]
demo-video login <config.json>
```

## Documentation

- [How the pipeline works](docs/guide/pipeline.md)
- [Script format](docs/guide/script-format.md)
- [Config](docs/guide/config.md)
- [Preflight selector gate](docs/guide/preflight.md)
- [Authenticated capture](docs/guide/authenticated-capture.md)
- [Third-party tabs](docs/guide/third-party-tabs.md)
- [Voice](docs/guide/voice.md)
- [Quality checks](docs/guide/quality-checks.md)
- [Motion cards](docs/guide/motion-cards.md)
- [Changelog](CHANGELOG.md)

## Replicability

Pin `voice.seed` in your config and lock your ffmpeg and Chromium versions to get byte-stable
reruns from the same script. The only inputs that change between demo iterations are
`DEMO_SCRIPT.md` and `demo.config.json`; everything else is deterministic given the same narration
audio.

## License

MIT
````

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/distribution.test.ts tests/readme.smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the quickstart for real (consumer check)**

Run from the worktree root: `FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json`
Expected: `✓ wrote demos/smoke/out/final.mp4 (...)`, and `demos/smoke/out/contact-sheet.png`
exists. (`demos/smoke/out` is git-ignored; confirm with `git status --short` showing nothing new.)

- [ ] **Step 6: Commit**

```bash
git add README.md tests/distribution.test.ts
git commit -m "docs: README leads with plugin install and a keyless quickstart"
```

---

### Task 7: Changelog 0.3.0 and the release runbook

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/runbooks/release.md`
- Test: `tests/distribution.test.ts` (append, and add `docs/runbooks/release.md` to `publicFiles()`)

- [ ] **Step 1: Write the failing test**

Add `"docs/runbooks/release.md"` to `publicFiles()`. Append:

```ts
describe("release preparation", () => {
  it("ships everything unreleased as the package version", () => {
    const cl = read("CHANGELOG.md");
    expect(cl).not.toMatch(/^## Unreleased/m);
    const versions = [...cl.matchAll(/^## (\S+)/gm)].map((m) => m[1]);
    expect(versions[0]).toBe(pkg.version);
    expect(versions.filter((v) => v === pkg.version)).toHaveLength(1);
    const start = cl.indexOf(`## ${pkg.version}`);
    const next = cl.indexOf("\n## ", start + 1);
    const section = cl.slice(start, next === -1 ? undefined : next);
    for (const h of ["### Breaking", "### Added", "### Fixed"]) {
      expect(section.split(`\n${h}\n`).length - 1, h).toBe(1);
    }
    expect(section).toContain("Claude Code plugin");
  });

  it("gives the maintainer the four release steps with exact commands", () => {
    const rb = read("docs/runbooks/release.md");
    expect(frontmatter(rb).verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const s of [
      "npm login",
      "npm publish --dry-run",
      "npm publish",
      `npm view agent-demo-video version`,
      `gh release create v${pkg.version}`,
      "gh repo edit OrionArchitekton/agent-demo-video",
    ]) {
      expect(rb, s).toContain(s);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/distribution.test.ts` → FAIL (`## Unreleased` present, runbook missing).

- [ ] **Step 3: Fold the changelog**

Rewrite the top of `CHANGELOG.md` so there is one `## 0.3.0` section with exactly one
`### Breaking`, one `### Added` and one `### Fixed`, in that order, then the existing older
sections unchanged. Entry text is moved verbatim; within each group the former "Unreleased"
entries come first, then the former 0.3.0 entries. The current file has the groups at:
Unreleased Fixed (line 5), Unreleased Added (12), Unreleased Breaking (89), Unreleased Added (111),
Unreleased Fixed (139), 0.3.0 Breaking (159), 0.3.0 Added (167), 0.3.0 Fixed (182).

Add these entries at the top of `### Added`:

```markdown
- Claude Code plugin: the repository is its own plugin marketplace.
  `/plugin marketplace add OrionArchitekton/agent-demo-video`, then
  `/plugin install agent-demo-video@agent-demo-video`, adds a `demo-video` skill that walks Claude
  through a video and a read-only `render-reviewer` agent that checks the contact sheet and first
  frame before narration is spent.
- Guide pages under `docs/guide/` hold the reference material that used to live in the README. The
  README now leads with install and a keyless quickstart.
- A maintainer release runbook, `docs/runbooks/release.md`.
```

Verify no entry was lost: `git show HEAD:CHANGELOG.md | grep -c '^- '` equals
`grep -c '^- ' CHANGELOG.md` minus 3.

- [ ] **Step 4: Create `docs/runbooks/release.md`**

````markdown
---
verified: 2026-10-14
review_after: 2027-01-14
topics: [release, npm, github-release, claude-code-plugin]
references:
  - package.json
  - CHANGELOG.md
  - .claude-plugin/plugin.json
  - .claude-plugin/marketplace.json
---

# Releasing agent-demo-video

The maintainer runs these steps by hand. Nothing in the repository publishes on its own.

## Before you start

- `master` is green: `pnpm install && pnpm test && pnpm typecheck && pnpm build`.
- `package.json`, `.claude-plugin/plugin.json` and the marketplace entry carry the same version
  (the distribution test fails otherwise), and `CHANGELOG.md` has a section for it.
- Record the current repository metadata for rollback:
  `gh repo view OrionArchitekton/agent-demo-video --json description,repositoryTopics`.

## 1. Log in to npm

```bash
npm login
npm whoami      # must print the account that owns agent-demo-video
```

## 2. Publish to npm

```bash
git switch master && git pull --ff-only
pnpm install --frozen-lockfile
npm publish --dry-run     # file list: dist, dist-remote, tools, README.md, LICENSE, package.json
npm publish
npm view agent-demo-video version     # prints 0.3.0
```

## 3. Create the GitHub release

Do this once the self-demo video is approved. The video is a release asset and is never committed.

```bash
awk '/^## 0\.3\.0$/{f=1;next} /^## /{f=0} f' CHANGELOG.md > /tmp/notes-0.3.0.md
gh release create v0.3.0 --target master --title "agent-demo-video v0.3.0" \
  --notes-file /tmp/notes-0.3.0.md agent-demo-video-self-demo.mp4
```

If the video is not ready yet, leave the file off the `create` command and attach it later with
`gh release upload v0.3.0 agent-demo-video-self-demo.mp4`.

## 4. Update the repository description and topics

```bash
gh repo edit OrionArchitekton/agent-demo-video \
  --description "Narrated, captioned demo videos of web apps from a script, headless. CLI and Claude Code plugin." \
  --remove-topic elevenlabs --add-topic claude-code --add-topic claude-code-plugin
```

## Verify

- `npm view agent-demo-video@0.3.0 version` prints `0.3.0`.
- In Claude Code, `/plugin marketplace add OrionArchitekton/agent-demo-video` and
  `/plugin install agent-demo-video@agent-demo-video` succeed, and `/plugin` lists the
  `demo-video` skill and the `render-reviewer` agent.
- The README poster opens the video from the release.

## Rollback

- npm: `npm deprecate agent-demo-video@0.3.0 "<reason>"`, then publish a fixed 0.3.1. (npm allows
  unpublishing only within 72 hours and never lets a version number be reused.)
- GitHub release: `gh release delete v0.3.0 --cleanup-tag`.
- Description and topics: rerun `gh repo edit` with the values recorded before step 4.
````

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/distribution.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/runbooks/release.md tests/distribution.test.ts
git commit -m "docs: fold unreleased changes into 0.3.0 and add the release runbook"
```

---

### Task 8: Full verification at the consumer boundary

No new files. Fix anything that fails in the task that owns it, then re-run.

- [ ] **Step 1: Repo quality bar**

```bash
pnpm test && pnpm typecheck && pnpm build && git diff --check origin/master
```

Expected: all pass. (If the Factory pack tests time out under heavy machine load, re-run that file
alone before treating it as a failure.)

- [ ] **Step 2: Plugin validator**

```bash
claude plugin validate --strict . && claude plugin validate --strict .claude-plugin/plugin.json
```

Expected: `Validation passed` twice.

- [ ] **Step 3: Install into an isolated Claude Code config**

This proves the install path without touching the developer's own Claude Code settings:

```bash
export CLAUDE_CONFIG_DIR=<scratch>/claude-config-probe
mkdir -p "$CLAUDE_CONFIG_DIR"
claude plugin marketplace add "$(pwd)"
claude plugin install agent-demo-video@agent-demo-video
claude plugin details agent-demo-video
unset CLAUDE_CONFIG_DIR
```

Expected: install succeeds; `details` shows version 0.3.0, `Skills (1) demo-video`,
`Agents (1) render-reviewer`.

- [ ] **Step 4: npm package contents unchanged**

```bash
npm pack --dry-run 2>&1 | grep -E 'skills/|agents/|\.claude-plugin|docs/' || echo "plugin files not in npm package (expected)"
```

Expected: the echo line. The plugin installs from git; the npm package stays the CLI.
