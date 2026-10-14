# Motion Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional `brand.motion` renders the title and end cards as animated HTML with HyperFrames (pinned 0.8.155), hook legible on frame 0, everything else unchanged.

**Architecture:** A pure HTML builder emits one HyperFrames composition per card (plain CSS keyframes, author text escaped). A renderer writes the composition to a temp project and runs the HyperFrames CLI through the existing no-shell `runCommand`, display-isolated. A requirement check (package resolvable, Node >= 22) runs before capture when motion is on. The pipeline swaps the static card command for the motion render at the two card sites.

**Tech Stack:** TypeScript (Node, zod, vitest), HyperFrames CLI 0.8.155 (optional dependency), ffmpeg.

**Spec:** `specs/motion-cards-spec.md`

**Run tests with:** `pnpm vitest run <file>`; full suite `pnpm test`; typecheck `pnpm typecheck`. Judge by exit code, never through a pipe.

**Known-good render command (estate-proven on 0.8.36):** `hyperframes render <projectDir> -o <out.mp4> --no-best-effort --no-browser-gpu -w 2 -q standard`. Composition root: `<div id="root" data-no-timeline data-composition-id="main" data-start="0" data-duration="<sec>" data-fps="<fps>" data-width="<w>" data-height="<h>">` containing one clip `<div class="clip" data-start="0" data-duration="<sec>" data-track-index="1">`. GSAP compositions register `window.__timelines`; this plan uses plain CSS keyframes, which the runtime seeks through `document.getAnimations()` (proven in Task 1: luma ramps 19.0 -> 29.7 over the animation). A CSS-only composition MUST carry `data-no-timeline` on the root (verified on 0.8.155: without it the renderer waits 45 s for `window.__timelines["main"]` and fails with `sub_timeline_readiness_timeout`).

---

## File structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | `optionalDependencies: { "hyperframes": "0.8.155" }` (exact) |
| `src/motion-cards/requirements.ts` (create) | `checkMotionRequirements()` -> `{ ok, hyperframesBin, version } \| { ok: false, problems }` |
| `src/motion-cards/compose.ts` (create) | `escapeHtml`, `titleCardHtml`, `endCardHtml` (pure) |
| `src/motion-cards/render.ts` (create) | `renderMotionCard(html, outPath, label, timeoutSec)` |
| `src/command-voice.ts` (modify) | `runCommand` accepts an optional `env` |
| `src/types.ts` (modify) | `brand.motion: z.boolean().optional()` (NO default: a default would change existing configs' parsed object and config hash; AC1) |
| `src/pipeline.ts`, `src/provenance.ts` (modify) | requirement check before capture; motion render at both card sites; `motionCards` report field |
| `README.md` (modify) | Document motion cards |

---

### Task 1: Spike, dependency and requirement check

**Files:** `package.json`, `pnpm-lock.yaml`, create `src/motion-cards/requirements.ts`, `src/motion-cards/requirements.test.ts`.

- [ ] **Step 1: Add the pinned optional dependency.** `pnpm add --save-optional --save-exact hyperframes@0.8.155`. Confirm `package.json` shows `"optionalDependencies": { "hyperframes": "0.8.155" }` and `node_modules/hyperframes/package.json` version is 0.8.155 with `repository.url` containing `github.com/heygen-com/hyperframes`.

- [ ] **Step 2: Spike (decides the approach; do not skip).** In a scratch dir OUTSIDE the repo, write `index.html`:

```html
<!doctype html><html><head><meta charset="UTF-8" />
<style>
html, body { width: 640px; height: 360px; margin: 0; overflow: hidden; background: #101418; }
#t { position: absolute; top: 140px; width: 100%; text-align: center; font: 600 64px Arial, sans-serif; color: #fff; opacity: 0; animation: rev 1s linear 0s 1 forwards; }
@keyframes rev { from { opacity: 0; } to { opacity: 1; } }
</style></head><body>
<div id="root" data-no-timeline data-composition-id="main" data-start="0" data-duration="2" data-fps="30" data-width="640" data-height="360">
  <div class="clip" data-start="0" data-duration="2" data-track-index="1"><div id="t">Spike</div></div>
</div></body></html>
```
Render it with `env -u DISPLAY -u WAYLAND_DISPLAY node <repo>/node_modules/hyperframes/bin/hyperframes.mjs render <scratchdir> -o <scratchdir>/out.mp4 --no-best-effort --no-browser-gpu -w 2 -q standard` and record exit code and log. Then probe: `ffprobe` (expect 640x360, 30 fps, ~2 s) and extract frames at 0.0 s and 1.5 s; the text must be invisible at 0.0 s and visible at 1.5 s (compare mean luma of the text region, e.g. `ffmpeg -ss T -i out.mp4 -frames:v 1 -vf crop=640:120:0:120,format=gray -f rawvideo -`). If CSS animation is NOT seeked (both frames identical), STOP and report NEEDS_CONTEXT with the evidence; do not add GSAP. Also record whether the first render downloaded a browser (network) and how long it took.

- [ ] **Step 3: Failing tests** (`src/motion-cards/requirements.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { checkMotionRequirements } from "./requirements";

describe("checkMotionRequirements", () => {
  it("passes with the package present and Node 22+", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.8.155", nodeVersion: "v22.3.0" });
    expect(r).toEqual({ ok: true, hyperframesBin: "/x/node_modules/hyperframes/bin/hyperframes.mjs", version: "0.8.155" });
  });
  it("names a missing package and how to install it", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => { throw new Error("Cannot find module"); }, readVersion: () => "", nodeVersion: "v22.3.0" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/hyperframes is not installed/);
  });
  it("names an old Node", () => {
    const r = checkMotionRequirements({ resolvePackageJson: () => "/x/node_modules/hyperframes/package.json", readVersion: () => "0.8.155", nodeVersion: "v20.11.1" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/Node 22 or newer/);
  });
});
```

- [ ] **Step 4: Run, expect FAIL** (module not found).

- [ ] **Step 5: Implement** (`src/motion-cards/requirements.ts`)

```ts
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** specs/motion-cards-spec.md S5: motion cards need the optional hyperframes package and Node 22+. */
export const MIN_NODE_MAJOR = 22;

export type MotionRequirements =
  | { ok: true; hyperframesBin: string; version: string }
  | { ok: false; problems: string[] };

interface Probes {
  resolvePackageJson: () => string;
  readVersion: (packageJsonPath: string) => string;
  nodeVersion: string;
}

const defaultProbes = (): Probes => {
  const require = createRequire(import.meta.url);
  return {
    resolvePackageJson: () => require.resolve("hyperframes/package.json"),
    readVersion: (p) => JSON.parse(readFileSync(p, "utf8")).version,
    nodeVersion: process.version,
  };
};

export function checkMotionRequirements(probes: Probes = defaultProbes()): MotionRequirements {
  const problems: string[] = [];
  const major = Number(probes.nodeVersion.replace(/^v/, "").split(".")[0]);
  if (!(major >= MIN_NODE_MAJOR)) problems.push(`brand.motion needs Node ${MIN_NODE_MAJOR} or newer (running ${probes.nodeVersion})`);
  let pkg: string | undefined;
  try { pkg = probes.resolvePackageJson(); } catch {
    problems.push('brand.motion needs the optional "hyperframes" package: hyperframes is not installed (run `npm install hyperframes@0.8.155`, or reinstall without --no-optional)');
  }
  if (problems.length || !pkg) return { ok: false, problems };
  return { ok: true, hyperframesBin: join(dirname(pkg), "bin", "hyperframes.mjs"), version: probes.readVersion(pkg) };
}
```
(Check `import.meta.url` works under this repo's build (tsup) and test (vitest) setup; if the repo is CommonJS, use `createRequire(__filename)` the way the codebase resolves other paths.)

- [ ] **Step 6: Run tests (PASS), typecheck. Commit** `feat: pin hyperframes 0.8.155 as an optional dependency; motion requirement check` and include the spike findings (commands, exit codes, frame luma numbers, browser download yes/no) in your report.

---

### Task 2: Card HTML builder (pure)

**Files:** create `src/motion-cards/compose.ts`, `src/motion-cards/compose.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { escapeHtml, titleCardHtml, endCardHtml } from "./compose";

const base = { width: 1080, height: 1920, fps: 30, durationSec: 2.2, font: "Arial", backdropTop: "#101418", backdropBottom: "#1d2733", accent: "#3fb950", title: "Demo <b>&</b> \"Co\"" };

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<script>alert('x')</script> & "q"`)).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;");
  });
});

describe("titleCardHtml", () => {
  it("declares the composition geometry, fps and duration", () => {
    const html = titleCardHtml(base);
    expect(html).toContain('data-composition-id="main"');
    expect(html).toContain('data-width="1080"');
    expect(html).toContain('data-height="1920"');
    expect(html).toContain('data-fps="30"');
    expect(html).toContain('data-duration="2.2"');
  });
  it("never emits author text as markup", () => {
    const html = titleCardHtml({ ...base, subtitle: "<img src=x onerror=alert(1)>", hook: "Stop <pasting>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<pasting>");
    expect(html).toContain("Demo &lt;b&gt;&amp;&lt;/b&gt; &quot;Co&quot;");
  });
  it("shows the hook at full opacity from the first frame", () => {
    const html = titleCardHtml({ ...base, hook: "Stop pasting secrets" });
    const hookRule = html.match(/#hook\s*\{[^}]*\}/)?.[0] ?? "";
    expect(hookRule).not.toMatch(/opacity:\s*0[;\s]/);
    expect(html).toMatch(/@keyframes settle\s*\{\s*from\s*\{[^}]*scale\(1\.0[1-9]\)/);
    expect(html).not.toMatch(/@keyframes settle[^}]*opacity:\s*0/);
  });
  it("reveals the product name after the hook when a hook is set", () => {
    const html = titleCardHtml({ ...base, hook: "Stop pasting secrets" });
    expect(html).toMatch(/#title\s*\{[^}]*opacity:\s*0/);
    expect(html).toMatch(/#title\s*\{[^}]*animation:[^;]*reveal/);
  });
  it("uses the configured colors and font", () => {
    const html = titleCardHtml(base);
    expect(html).toContain("#101418");
    expect(html).toContain("#1d2733");
    expect(html).toContain("#3fb950");
    expect(html).toContain("Arial");
  });
});

describe("endCardHtml", () => {
  it("reveals the URL and fades the title in", () => {
    const html = endCardHtml({ ...base, url: "example.com/demo" });
    expect(html).toContain("example.com/demo");
    expect(html).toMatch(/#url\s*\{[^}]*animation:[^;]*reveal/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/motion-cards/compose.ts`: `escapeHtml` (replace `&` first, then `<`, `>`, `"`, `'` as `&#39;`); a `CardHtmlOpts` interface (`width, height, fps, durationSec, font, backdropTop, backdropBottom, accent, title, subtitle?, hook?, url?`); colors and the font name must be validated to the formats the schema already enforces (hex colors, font names) and still be inserted through `escapeHtml` for defense in depth; a shared `page(opts, bodyHtml, css)` that emits the doctype, `html, body { width:Wpx; height:Hpx; margin:0; overflow:hidden; }`, a full-canvas linear-gradient backdrop from `backdropTop` to `backdropBottom`, the composition root and single clip element from the header above, and these keyframes:

```css
@keyframes settle { from { transform: scale(1.04); } to { transform: scale(1); } }
@keyframes reveal { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
@keyframes draw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fadeout { from { opacity: 1; } to { opacity: 0; } }
```
Title card layout (sizes relative to height, centered): with a hook, `#hook` (white, bold, the existing `hookLayout` font size and wrapped lines from `src/cards.ts`, each line in its own block, `animation: settle 0.5s ease-out 0s 1 both`, NO opacity rule), then `#bar` (accent, `transform-origin: center; animation: draw 0.4s ease-out 0.3s 1 both`), then `#title` (small, `opacity: 0; animation: reveal 0.5s ease-out 0.5s 1 forwards`) and `#subtitle` (`opacity: 0; animation: reveal 0.5s ease-out 0.7s 1 forwards`). Without a hook, `#title` is large, fully visible, `animation: settle 0.5s ease-out 0s 1 both`, then bar and subtitle as above. End card: `#title` (`opacity: 0; animation: reveal 0.5s ease-out 0.1s 1 forwards`), `#url` in the accent color (`opacity: 0; animation: reveal 0.5s ease-out 0.4s 1 forwards`). Every card ends with a 0.4 s fade to the backdrop (the root's content, not the backdrop: `animation: fadeout 0.4s linear <durationSec-0.4>s 1 forwards` on a content wrapper). Text nodes are always `escapeHtml(...)`.

- [ ] **Step 4: Run (PASS), typecheck. Commit** `feat: motion card HTML compositions (escaped text, frame-0-legible hook)`

---

### Task 3: Run HyperFrames to render a card

**Files:** modify `src/command-voice.ts` (`runCommand` optional `env`), create `src/motion-cards/render.ts`, `src/motion-cards/render.test.ts`.

- [ ] **Step 1: `runCommand` env.** Add an optional 5th parameter `opts?: { env?: Record<string, string> }` passed to `spawn` (`env: opts?.env ?? process.env`). Test: a fixture `tests/fixtures/voice/print-env.sh` (`#!/usr/bin/env bash` / `printf '%s' "${DISPLAY-unset}" > "$1"`) run with `{ env: { PATH: process.env.PATH! } }` writes `unset`. Existing runCommand tests must stay green.

- [ ] **Step 2: Renderer** (`src/motion-cards/render.ts`)

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../command-voice";
import { headlessBrowserEnv } from "../browser-env";

/** Render one motion card composition to an MP4 with the HyperFrames CLI (no shell, no desktop display). */
export async function renderMotionCard(hyperframesBin: string, html: string, outPath: string, label: string, timeoutSec = 300): Promise<void> {
  const project = await mkdtemp(join(tmpdir(), "motion-card-"));
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "index.html"), html, "utf8");
  await runCommand(
    `motion card (${label})`,
    [process.execPath, hyperframesBin, "render", project, "-o", outPath, "--no-best-effort", "--no-browser-gpu", "-w", "2", "-q", "standard"],
    {},
    timeoutSec,
    { env: headlessBrowserEnv() },
  );
}
```

- [ ] **Step 3: Integration test** (`src/motion-cards/render.test.ts`, `{ timeout: 300_000 }`, `describe.skipIf(!checkMotionRequirements().ok)` with the skip reason printed): render `titleCardHtml` for 640x360, 30 fps, 2 s with hook "Stop pasting secrets", then probe with the repo's existing ffprobe helper (`probeDuration`/`probeDeliverable` style) for width 640, height 360, fps 30, duration within 0.1 s of 2; and a frame-0 probe: extract frame 0 of the hook region as gray raw bytes and assert at least 1% of pixels have luma > 200 (the hook is visible on the first frame). Add a second case: a deliberately broken composition (`<html>` with no root) rejects with `/motion card \(broken\)/`.

- [ ] **Step 4: Run (PASS), typecheck. Commit** `feat: render motion cards with the hyperframes CLI (display-isolated, no shell)`

---

### Task 4: Pipeline, schema and report

**Files:** modify `src/types.ts`, `src/pipeline.ts`, `src/provenance.ts`; tests `src/types.test.ts`, `src/provenance.test.ts`, create `tests/motion-cards.smoke.test.ts`.

- [ ] **Step 1: Failing tests.** Schema: `brand: { title: "T", motion: true }` parses with `motion === true`; `brand: { title: "T" }` parses with `"motion" in brand === false` (no default, AC1). Report: `buildRenderReport({ ...base, motionCards: { renderer: "hyperframes", version: "0.8.155" } }).motionCards` equals that; absent -> no key.

- [ ] **Step 2: Implement.**
  - `src/types.ts` brand object: `motion: z.boolean().optional(),` inside the strict object (before `.transform`), with a comment that it has no default on purpose (AC1: existing configs parse byte-identically).
  - `src/pipeline.ts`: before capture (next to the other up-front checks, after `resolveTtsMode`), if `config.brand?.motion` and either card is enabled: `const motion = checkMotionRequirements(); if (!motion.ok) throw new Error("[agent-demo-video] " + motion.problems.join("; "));`. At the title card site: when motion is on, `renderMotionCard(motion.hyperframesBin, titleCardHtml({...cardBase, durationSec: b.titleSec, hook: b.hook}), titlePath, "title")` instead of `ffmpeg(titleCardArgs(...))`; same at the end card site with `endCardHtml` and `"end"`. Everything after (silentCard audio, segment kinds, offsets) is unchanged. Keep the `hook` status logic exactly as it is (it applies to motion cards too).
  - `src/provenance.ts`: `motionCards?: { renderer: "hyperframes"; version: string }` in report and params, spread only when defined; the pipeline passes it when motion cards were rendered.

- [ ] **Step 3: Smoke** (`tests/motion-cards.smoke.test.ts`, `{ timeout: 600_000 }`, skipIf requirements not ok, FAKE_TTS=1 saved/restored): the 2-shot fixture with `platform: "shorts"`, `brand: { title: "Demo Fixture", subtitle: "Ask once", url: "example.com", hook: "Stop pasting secrets", motion: true }`. Assert `r.report.parity.ok`, `report.deliverable.ok`, `report.motionCards` = `{ renderer: "hyperframes", version: "0.8.155" }`, `report.hook === "set"`, and the frame-0 probe on `final.mp4` (hook region has >= 1% pixels with luma > 200). Second case: the same config without `motion` produces no `motionCards` key.

- [ ] **Step 4: Visual check (controller reviews):** save frame 0 and frames at 0.6 s and 1.2 s of the motion Shorts `final.mp4` to `<scratch>/motion-f0.png`, `motion-f06.png`, `motion-f12.png`, and the end card's midpoint to `motion-end.png`.

- [ ] **Step 5: Run touched tests, the FULL suite, typecheck. Commit** `feat: brand.motion renders title and end cards with HyperFrames`

---

### Task 5: README

- [ ] Add a "Motion cards" section: `brand.motion: true`; requires the optional `hyperframes` package (pinned 0.8.155, installed by default unless `--no-optional`) and Node 22+; what animates (hook visible on the first frame and settles; bar draws; name, subtitle and URL reveal); failures stop the run; the report's `motionCards` field; first render may download a headless browser (state what Task 1's spike found). Add `motion` to the Config table's brand row. No long dashes. Run `tests/readme.smoke.test.ts`; commit `docs: README for motion cards`.

---

## Self-review notes

- Spec coverage: S1 -> Tasks 1, 4 (AC1); S2 -> Task 4 (AC2); S3 -> Tasks 2, 3, 4 (AC3); S4 -> Task 2 (AC4); S5 -> Tasks 1, 3 (AC5); S6 -> Tasks 3, 4 (AC6).
- Names: `checkMotionRequirements`, `MIN_NODE_MAJOR`, `escapeHtml`, `titleCardHtml`, `endCardHtml`, `renderMotionCard`, report field `motionCards`, config `brand.motion`.
- Risk: Task 1's spike gates the CSS approach; if HyperFrames does not seek CSS animations, stop and decide (GSAP would be a second dependency).
