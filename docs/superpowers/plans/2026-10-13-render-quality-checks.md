# Render Quality Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advisory transcript check, isolate headless browsers from the desktop display, and let Shorts open on a large hook line.

**Architecture:** Three independent slices on existing seams. (1) A pure environment builder strips `DISPLAY`/`WAYLAND_DISPLAY` from every headless browser launch. (2) A pure phrase comparator plus a runner that reuses the configured `voice.aligner` over the finished video; results go to the render report. (3) An optional `brand.hook` line drawn large on the title card, wrapped to the canvas, with a `hook` status in the report for Shorts.

**Tech Stack:** TypeScript (Node, zod, vitest, Playwright), ffmpeg drawtext.

**Spec:** `specs/render-quality-checks-spec.md`

**Run tests with:** `env -u DISPLAY -u WAYLAND_DISPLAY pnpm vitest run <file>`; full suite `env -u DISPLAY -u WAYLAND_DISPLAY pnpm test`; typecheck `pnpm typecheck`. Judge every run by its exit code, never through a pipe. EXCEPTION: Task 1's acceptance run deliberately keeps a dead display set.

---

## File structure

| File | Responsibility |
|---|---|
| `src/browser-env.ts` (create) | `headlessBrowserEnv(env)`: a copy of the environment without display variables |
| `src/capture.ts`, `src/preflight.ts` (modify) | Pass `env: headlessBrowserEnv()` to every headless launch |
| `src/transcript-check.ts` (create) | `splitPhrases`, `droppedPhrases` (pure), `runTranscriptCheck` (runs the aligner) |
| `src/cards.ts` (modify) | `wrapHook`, hook layout in `titleCardArgs` |
| `src/types.ts` (modify) | `brand.hook` |
| `src/provenance.ts` (modify) | `transcriptCheck`, `hook` report fields |
| `src/pipeline.ts` (modify) | Wire the transcript check and hook file/status |
| `README.md` (modify) | Document all three |

---

### Task 1: Headless browsers ignore the desktop display

**Files:** Create `src/browser-env.ts`, `src/browser-env.test.ts`, `tests/dead-display.smoke.test.ts`; modify `src/capture.ts` (launches at the `chromium.launch` pair near line 449 and the live `launchPersistentContext` near line 538; the login launch near line 640 only when `auth.headlessLogin`), `src/preflight.ts` (the `chromium.launch` pair near line 258).

- [ ] **Step 1: Failing unit test** (`src/browser-env.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { headlessBrowserEnv } from "./browser-env";

describe("headlessBrowserEnv", () => {
  it("drops the desktop display variables and keeps everything else", () => {
    const env = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", PATH: "/bin", HOME: "/h" };
    expect(headlessBrowserEnv(env)).toEqual({ PATH: "/bin", HOME: "/h" });
  });
  it("does not modify the input", () => {
    const env = { DISPLAY: ":0" };
    headlessBrowserEnv(env);
    expect(env).toEqual({ DISPLAY: ":0" });
  });
  it("omits undefined values", () => {
    expect(headlessBrowserEnv({ A: undefined, B: "1" })).toEqual({ B: "1" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found): `env -u DISPLAY -u WAYLAND_DISPLAY pnpm vitest run src/browser-env.test.ts`

- [ ] **Step 3: Implement** (`src/browser-env.ts`)

```ts
/**
 * Environment for HEADLESS browsers: everything except the desktop display variables.
 * A headless browser never needs a display, but Chromium still reads DISPLAY/WAYLAND_DISPLAY;
 * when that display is set but dead (common on WSL after the display server crashes) every
 * capture stalls ~30 s and fails on an unrelated locator. specs/render-quality-checks-spec.md S2.
 */
const DISPLAY_VARS = new Set(["DISPLAY", "WAYLAND_DISPLAY"]);

export function headlessBrowserEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !DISPLAY_VARS.has(k)) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Wire every headless launch.** Import `headlessBrowserEnv` and add `env: headlessBrowserEnv()` to:
  - `src/capture.ts`: both `chromium.launch({ headless: true ... })` calls in the dashboard path, and the live `chromium.launchPersistentContext(profileDir, { ..., headless: true })`.
  - `src/capture.ts` `captureLogin`: `...(auth.headlessLogin ? { env: headlessBrowserEnv() } : {})` (a headed login keeps the full environment).
  - `src/preflight.ts`: both `chromium.launch({ headless: true ... })` calls.

- [ ] **Step 5: Dead-display smoke test** (`tests/dead-display.smoke.test.ts`): render the existing 2-shot fixture with `FAKE_TTS=1` while `process.env.DISPLAY = ":99"` and `process.env.WAYLAND_DISPLAY = "wayland-dead"` (no such display); restore both after. Use the same render helper shape as `tests/pipeline.smoke.test.ts` (fixture `tests/fixtures/demo.md` with `FIXTURE_URL` replaced by `pathToFileURL(resolve("tests/fixtures/page.html")).href`, `resolution: { width: 1280, height: 720 }`). Assert `r.report.parity.ok` is true. Give the test `{ timeout: 180_000 }`.

- [ ] **Step 6: Run** `env -u DISPLAY -u WAYLAND_DISPLAY pnpm vitest run src/browser-env.test.ts tests/dead-display.smoke.test.ts` (PASS), then the AC3 proof WITHOUT unsetting the real display: `pnpm vitest run tests/capture.smoke.test.ts` (must PASS on a workstation whose real display is dead; record the exit code). `pnpm typecheck`.

- [ ] **Step 7: Commit** `git commit -m "fix: headless browsers launch without the desktop display variables"`

---

### Task 2: Phrase comparison (pure)

**Files:** Create `src/transcript-check.ts` (pure part), `src/transcript-check.test.ts`; modify `specs/render-quality-checks-spec.md` (scenario 1 wording).

- [ ] **Step 1: Spec wording.** In scenario 1 replace "compared with the narration phrase by phrase, on letters and digits only (so "A.I." matches "AI"), ignoring coincidental matches shorter than three characters. Phrases with under 70% of their characters heard are reported as dropped." with "compared with the narration phrase by phrase on letters and digits only (so "A.I." matches "AI"): a phrase counts as heard when at least 70% of its three-letter sequences occur in the recognized speech; others are reported as dropped." In Vocabulary, "dropped phrase" becomes "a narration phrase (a sentence or clause) most of whose three-letter sequences do not occur in the recognized speech."

- [ ] **Step 2: Failing tests** (`src/transcript-check.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { splitPhrases, droppedPhrases } from "./transcript-check";

describe("splitPhrases", () => {
  it("splits narration into sentences and trims", () => {
    expect(splitPhrases(["First line. Second one!", "Third?  "])).toEqual(["First line.", "Second one!", "Third?"]);
  });
});

describe("droppedPhrases", () => {
  it("treats spelling variants as heard", () => {
    const phrases = ["I use A.I. assistants.", "Today's is from Work Cue."];
    expect(droppedPhrases(phrases, "i use ai assistants todays is from workcue")).toEqual([]);
  });
  it("flags a phrase the render never said", () => {
    const phrases = ["Paste only what the task needs.", "Then diff the result."];
    expect(droppedPhrases(phrases, "paste only what the task needs and that is all")).toEqual(["Then diff the result."]);
  });
  it("tolerates small recognition differences", () => {
    expect(droppedPhrases(["Keep a human on every commitment."], "keep a human on every commitments")).toEqual([]);
  });
  it("never flags a phrase with no letters or digits", () => {
    expect(droppedPhrases(["...", "?!"], "")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (module not found).

- [ ] **Step 4: Implement** (`src/transcript-check.ts`, pure part)

```ts
/**
 * Transcript check (specs/render-quality-checks-spec.md S1): did the finished video SAY the script?
 * Comparison is on letters and digits only, by three-letter sequences, so "A.I." matches "AI" and
 * "Work Cue" matches "WorkCue". Advisory: recognizers mishear names and spelled numbers.
 */
export const MIN_HEARD = 0.7;

const letters = (s: string): string => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");

function trigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 3 <= s.length; i++) out.push(s.slice(i, i + 3));
  return out;
}

/** Narration texts -> sentence-level phrases. */
export function splitPhrases(narrations: string[]): string[] {
  return narrations.flatMap((n) => n.split(/(?<=[.!?])\s+/)).map((p) => p.trim()).filter(Boolean);
}

/** Phrases whose three-letter sequences mostly do not occur in the heard text. */
export function droppedPhrases(phrases: string[], heard: string, minHeard = MIN_HEARD): string[] {
  const heardSet = new Set(trigrams(letters(heard)));
  return phrases.filter((p) => {
    const t = trigrams(letters(p));
    if (t.length === 0) return false;
    const hit = t.filter((g) => heardSet.has(g)).length;
    return hit / t.length < minHeard;
  });
}
```

- [ ] **Step 5: Run, expect PASS** (5 tests). `pnpm typecheck`.

- [ ] **Step 6: Commit** `git commit -m "feat: transcript phrase comparison on letter trigrams"` (include the spec edit).

---

### Task 3: Run the transcript check in the pipeline and report it

**Files:** Modify `src/transcript-check.ts` (runner), `src/provenance.ts`, `src/pipeline.ts`; create `tests/fixtures/voice/align-hear-all.sh`, `tests/fixtures/voice/align-drop-second.sh`, `tests/transcript-check.smoke.test.ts`; test `src/provenance.test.ts`.

- [ ] **Step 1: Fixture aligners** (chmod +x; args `{audio} {text} {out}`; they ignore the audio and "hear" the text file)

`align-hear-all.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
python3 -c '
import json, sys
words = open(sys.argv[1]).read().split()
json.dump([{"word": w, "start": round(i * 0.2, 3), "end": round(i * 0.2 + 0.2, 3)} for i, w in enumerate(words)], open(sys.argv[2], "w"))
' "$2" "$3"
```

`align-drop-second.sh` (hears every sentence except the second one):
```bash
#!/usr/bin/env bash
set -euo pipefail
python3 -c '
import json, re, sys
sents = [s for s in re.split(r"(?<=[.!?])\s+", open(sys.argv[1]).read().strip()) if s]
kept = " ".join(s for i, s in enumerate(sents) if i != 1).split()
json.dump([{"word": w, "start": round(i * 0.2, 3), "end": round(i * 0.2 + 0.2, 3)} for i, w in enumerate(kept)], open(sys.argv[2], "w"))
' "$2" "$3"
```

- [ ] **Step 2: Runner** (append to `src/transcript-check.ts`)

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, readWordsFile } from "./command-voice";

export type TranscriptCheck =
  | { ran: true; droppedPhrases: string[] }
  | { ran: false; reason: string };

/** Run the configured aligner once over the finished video; never throws (advisory). */
export async function runTranscriptCheck(
  videoPath: string, narrations: string[], aligner: string[] | undefined, timeoutSec: number, workDir: string,
): Promise<TranscriptCheck> {
  if (!aligner) return { ran: false, reason: "no voice.aligner configured" };
  try {
    await mkdir(workDir, { recursive: true });
    const textPath = join(workDir, "transcript-check.txt");
    const outPath = join(workDir, "transcript-check.words.json");
    await writeFile(textPath, narrations.join(" "), "utf8");
    await runCommand("transcript check", aligner, { audio: videoPath, text: textPath, out: outPath }, timeoutSec);
    const words = await readWordsFile(outPath, "transcript check");
    if (!words) return { ran: false, reason: "aligner wrote no word timings" };
    return { ran: true, droppedPhrases: droppedPhrases(splitPhrases(narrations), words.map((w) => w.word).join(" ")) };
  } catch (e) {
    return { ran: false, reason: `aligner failed: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 3: Report field.** In `src/provenance.ts` add to `RenderReport` and `buildRenderReport`'s params `transcriptCheck?: TranscriptCheck` (import the type) and in the returned object `...(o.transcriptCheck ? { transcriptCheck: o.transcriptCheck } : {})`. Add a test inside the existing `describe("buildRenderReport")`: `buildRenderReport({ ...base, transcriptCheck: { ran: false as const, reason: "no voice.aligner configured" } }).transcriptCheck` equals that object.

- [ ] **Step 4: Pipeline.** In `src/pipeline.ts`, after `buildContactSheet(...)` and before the source-build assertion:

```ts
  const transcriptCheck = await runTranscriptCheck(
    result.outPath,
    shots.map((s) => s.narration).filter(Boolean),
    config.voice.aligner,
    config.voice.timeoutSec ?? DEFAULT_VOICE_TIMEOUT_SEC,
    join(audioDir, "transcript-check"),
  );
  if (transcriptCheck.ran && transcriptCheck.droppedPhrases.length) {
    console.warn(
      `[agent-demo-video] transcript check: ${transcriptCheck.droppedPhrases.length} narration phrase(s) not heard in the render: ` +
        transcriptCheck.droppedPhrases.map((p) => JSON.stringify(p)).join(", "),
    );
  }
```
and pass `transcriptCheck` into `buildRenderReport({...})`. Use whatever variable the pipeline already uses for the narrated shots list and the audio directory (read the surrounding code; `shots` and `audioDir` are the names at the TTS loop).

- [ ] **Step 5: Smoke tests** (`tests/transcript-check.smoke.test.ts`, `{ timeout: 180_000 }`, save/restore `FAKE_TTS` and `ELEVENLABS_API_KEY` as `tests/command-voice.smoke.test.ts` does, render the same fixture with `voice: { provider: "command", command: [tone.sh ...], aligner: [<fixture>, "{audio}", "{text}", "{out}"] }`):
  - AC1a: `align-hear-all.sh` -> `report.transcriptCheck` equals `{ ran: true, droppedPhrases: [] }`.
  - AC1b: `align-drop-second.sh` -> `report.transcriptCheck.ran` true and `droppedPhrases` equals the fixture narration's second sentence; a `console.warn` call matches `/transcript check: 1 narration phrase/` (spy, restore in finally).
  - AC1c / AC5: the existing FAKE_TTS fixture render (no aligner) -> `report.transcriptCheck` equals `{ ran: false, reason: "no voice.aligner configured" }`.
  Note: the fixture narration's two shots are one sentence each ("This is the first shot of the smoke test." / "And this is the second shot."), so "second sentence" = shot two's narration.

- [ ] **Step 6: Run** the new files plus `src/provenance.test.ts`; full suite; typecheck. **Commit** `git commit -m "feat: advisory transcript check of the finished video, recorded in the render report"`

---

### Task 4: Shorts hook card

**Files:** Modify `src/types.ts` (brand schema), `src/cards.ts`, `src/pipeline.ts`, `src/provenance.ts`; tests `src/cards.test.ts`, `src/types.test.ts`, `tests/hook-card.smoke.test.ts`.

- [ ] **Step 1: Failing tests**

`src/types.test.ts`:
```ts
describe("brand.hook", () => {
  const base = { script: "x", dashboardBaseUrl: "http://x" };
  it("accepts a hook up to 60 characters", () => {
    expect(DemoConfigSchema.parse({ ...base, brand: { title: "T", hook: "Stop pasting secrets into AI" } }).brand?.hook).toBe("Stop pasting secrets into AI");
  });
  it("rejects a hook over 60 characters", () => {
    expect(() => DemoConfigSchema.parse({ ...base, brand: { title: "T", hook: "x".repeat(61) } })).toThrowError(/60/);
  });
});
```

`src/cards.test.ts`:
```ts
import { wrapHook, hookLayout } from "./cards";
describe("wrapHook", () => {
  it("wraps on word boundaries within the width", () => {
    expect(wrapHook("Stop pasting client secrets into AI chats", 14)).toEqual(["Stop pasting", "client secrets", "into AI chats"]);
  });
  it("keeps a single over-long word on its own line", () => {
    expect(wrapHook("Supercalifragilistic now", 10)).toEqual(["Supercalifragilistic", "now"]);
  });
});
describe("hookLayout", () => {
  it("sizes the hook larger than the product title and fits the canvas width", () => {
    const l = hookLayout(1080, 1920, "Stop pasting client secrets into AI chats");
    expect(l.fontSize).toBeGreaterThan(Math.round(1920 * 0.034));
    expect(Math.max(...l.lines.map((s) => s.length)) * l.fontSize * 0.55).toBeLessThanOrEqual(1080 * 0.9);
  });
});
```
plus a `titleCardArgs` test: with `hook` in the opts and `hookFile` in files, the filtergraph contains `textfile=` for the hook file and the title's fontsize is smaller than the hook's.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**
  - `src/types.ts` brand object: `hook: z.string().max(60, "brand.hook must be at most 60 characters").optional(),` (keep `.strict()`).
  - `src/cards.ts`:

```ts
/** Greedy word wrap; a single word longer than maxChars gets its own line. */
export function wrapHook(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.trim().split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Hook font size and lines: large (7.5% of height on portrait, 8.5% on landscape), wrapped to 90% of width. */
export function hookLayout(width: number, height: number, hook: string): { fontSize: number; lines: string[] } {
  const fontSize = Math.round(height * (height > width ? 0.075 : 0.085));
  const maxChars = Math.max(6, Math.floor((width * 0.9) / (fontSize * 0.55)));
  return { fontSize, lines: wrapHook(hook, maxChars) };
}
```
  - `CardOpts` gains `hook?: string`; `CardTextFiles` gains `hookFile?: string`. In `titleCardArgs`, when `o.hook && files.hookFile`: draw the hook block centered (`fontsize=${layout.fontSize}`, `line_spacing=${Math.round(layout.fontSize * 0.2)}`, `y=(h-text_h)/2-${Math.round(o.height * 0.06)}`), then the accent bar and the product title BELOW the block at `fontsize=${Math.round(o.height * 0.034)}` and `y=(h)/2+${Math.round(blockH / 2)}`, where `blockH = layout.lines.length * layout.fontSize * 1.2`; the subtitle (if any) goes under the title. Without a hook, the existing layout is unchanged byte for byte.
  - `src/pipeline.ts` title-card block: when `b.titleCard && b.hook`, write `hookLayout(width, height, b.hook).lines.join("\n")` to `join(segDir, "card_hook_text.txt")` and pass `hook: b.hook` in the card opts and `hookFile` in files. Compute `hook` status: if `config.platform === "shorts" && b.titleCard` -> `b.hook ? "set" : "missing"`; else if `b.hook` -> `"set"`; else undefined. When `"missing"`, `console.warn("[agent-demo-video] shorts render has no brand.hook: frame 0 shows only the product name; a short hook line on the first frame holds far more viewers")`.
  - `src/provenance.ts`: `hook?: "set" | "missing"` in report and params, spread only when defined.

- [ ] **Step 4: Smoke** (`tests/hook-card.smoke.test.ts`, `{ timeout: 180_000 }`, FAKE_TTS=1 saved/restored, the 2-shot fixture with `platform: "shorts"` and `brand: { title: "Demo Fixture" }`):
  - with `brand.hook: "Stop pasting secrets"` -> `report.hook === "set"`, and `out/seg/card_hook_text.txt` exists.
  - without a hook -> `report.hook === "missing"` and a warn call matches `/no brand.hook/`.
  - landscape (no platform) with brand and no hook -> `"hook" in report` is false.

- [ ] **Step 5: Visual check (not automated):** render the hooked Shorts fixture once and look at `contact-sheet.png` and the first frame (`ffmpeg -ss 0 -i out/final.mp4 -frames:v 1 frame0.png`); the hook must be large, centered and fully inside the frame. Record what you saw in the report.

- [ ] **Step 6: Run** the touched tests, full suite, typecheck. **Commit** `git commit -m "feat: optional brand.hook drawn large on the frame-0 title card; Shorts warn without one"`

---

### Task 5: README

- [ ] Add a short "Quality checks" section: transcript check (needs `voice.aligner`; advisory; `transcriptCheck` in the report), headless display isolation (no action needed; explains the old 30 s stalls), and `brand.hook` (60 characters max, wrapped automatically, Shorts warn without one). No long dashes. Run `tests/readme.smoke.test.ts`; commit `docs: README for transcript check, display isolation and brand.hook`.

---

## Self-review notes

- Spec coverage: S1 -> Tasks 2, 3 (AC1, AC2, AC5); S2 -> Task 1 (AC3); S3 -> Task 4 (AC4); docs -> Task 5.
- Names: `headlessBrowserEnv`, `splitPhrases`, `droppedPhrases`, `MIN_HEARD`, `runTranscriptCheck`, `TranscriptCheck`, `wrapHook`, `hookLayout`, report fields `transcriptCheck`, `hook`.
