# agent-demo-video — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable, agent-driven pipeline that turns a demo script + a running web app into a finished ≤5-min narrated, captioned MP4 — fully automated, deterministic, headless on Linux — packaged as a repo + a Claude Code skill.

**Architecture:** Manifest-as-contract. A `Manifest` (shots: narration + browser actions) drives an **audio-first closed loop**: ElevenLabs generates each shot's narration *first* (`with-timestamps` → audio + char alignment), the measured audio duration becomes that shot's authoritative dwell time, Playwright `recordVideo` captures the app paced to those durations (with an injected fake cursor + overlays), and ffmpeg stitches video + narration + burned-in captions. Pure logic (timeline math, caption building, command construction, parsing, fake-TTS) is dependency-injected and unit-tested keyless; the I/O edges (ElevenLabs HTTP, Playwright capture, ffmpeg exec) are thin and smoke-tested with `FAKE_TTS=1`.

**Tech Stack:** TypeScript (strict), Node 24, pnpm, Playwright, system ffmpeg/ffprobe, ElevenLabs REST (via `fetch`), Zod, Vitest. ElevenLabs key from Doppler `claude-code-use/prd` (`ELEVENLABS_API_KEY`).

---

## Design decisions (locked from the research report)

- **Build-own**, clone/fork nothing. Report: `scratchpad/demo-video-pipeline-architecture.md`.
- **Audio-first sync** (not script-sleeps, not post-hoc alignment): `d_i = duration(narration_i)`; browser dwells `d_i`; caption offset `o_i = Σ d_{<i}`; ffmpeg concat honors `{d_i}` → structural zero-drift. **pad-to-max:** if a UI action takes longer than its narration, extend dwell AND pad narration with trailing silence to `max(action, audio)`.
- **`FAKE_TTS=1`** = keyless path: deterministic duration estimate + synthetic alignment + ffmpeg-generated silent audio. Mirrors Proctor's `PROCTOR_FAKE_LLM`. Whole pipeline runs in CI/dev with no API key.
- **UiPath/third-party tabs = prebaked clips** by default (most fragile surface); live-capture is opt-in later.
- **Remotion = out of scope** for v1 (license exposure + not needed); pure ffmpeg compositor.
- Single package (not a monorepo) — simpler. Pure modules import nothing but `./types` + std; I/O modules are the only ones touching `playwright`, `child_process`, `fetch`, `fs`.

## File structure

```
agent-demo-video/
  package.json · tsconfig.json · vitest.config.ts · .gitignore · .env.example · LICENSE(MIT) · README.md
  demo.config.sample.json
  src/
    types.ts          # Shot/Action/Manifest/DemoConfig/Alignment/TtsResult + zod schemas
    timeline.ts       # PURE: cumulative offsets + pad-to-max
    captions.ts       # PURE: alignment[]+offsets -> SRT
    parse-script.ts   # PURE: structured DEMO_SCRIPT.md -> Manifest
    fake-tts.ts       # PURE: estimateDuration + synthAlignment (no I/O)
    ffmpeg.ts         # PURE arg-builders + thin exec()/probeDuration()
    overlay.ts        # PURE: injected fake-cursor/click/chapter CSS+JS string
    tts.ts            # I/O: ElevenLabs with-timestamps OR fake-tts -> {audioPath,durationSec,alignment}
    capture.ts        # I/O: Playwright recordVideo driver (dashboard actions / prebaked clips)
    verify.ts         # PURE: parity/segment/runtime assertions
    config.ts         # I/O: load+validate demo.config.json
    pipeline.ts       # orchestrates parse->tts->captions->capture->stitch->verify
    cli.ts            # `demo-video <config.json>` entrypoint
  tests/ (colocated *.test.ts)
  ~/.claude/skills/demo-video/SKILL.md   # skill wrapper (separate task)
```

---

## Task 1: Scaffold + tooling

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `LICENSE`, `demo.config.sample.json`

- [ ] **Step 1: package.json**
```json
{
  "name": "agent-demo-video",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "demo-video": "src/cli.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "demo": "tsx src/cli.ts"
  },
  "dependencies": { "playwright": "^1.48.0", "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0", "tsx": "^4.19.0", "@types/node": "^22.0.0" },
  "packageManager": "pnpm@9.12.0"
}
```
- [ ] **Step 2: tsconfig.json**
```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true, "esModuleInterop": true, "types": ["node"], "noEmit": true }, "include": ["src", "tests"] }
```
- [ ] **Step 3: vitest.config.ts**
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts", "tests/**/*.test.ts"], environment: "node", testTimeout: 60_000 } });
```
- [ ] **Step 4:** `.gitignore` (`node_modules/`, `out/`, `*.mp4`, `*.webm`, `*.mp3`, `.env`, `*.tsbuildinfo`), `.env.example` (`ELEVENLABS_API_KEY=` + comment: sourced via `doppler run -p claude-code-use -c prd`), `LICENSE` (MIT, 2026), and `demo.config.sample.json` (see Task 11 for shape).
- [ ] **Step 5:** `pnpm install`; then `pnpm exec playwright install chromium` (downloads the browser). Verify `pnpm typecheck` runs (no src yet → trivially clean once a file exists; ok to defer).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: scaffold agent-demo-video"`

---

## Task 2: types.ts + zod schemas

**Files:** Create `src/types.ts`, `src/types.test.ts`

- [ ] **Step 1: Write the failing test** (`src/types.test.ts`)
```typescript
import { describe, it, expect } from "vitest";
import { ManifestSchema, DemoConfigSchema } from "./types";

describe("schemas", () => {
  it("parses a minimal manifest", () => {
    const m = { shots: [{ id: "s1", target: "dashboard", narration: "Hello.", actions: [{ kind: "goto", url: "/" }] }] };
    expect(ManifestSchema.parse(m).shots.length).toBe(1);
  });
  it("rejects an unknown action kind", () => {
    expect(() => ManifestSchema.parse({ shots: [{ id: "s1", target: "dashboard", narration: "x", actions: [{ kind: "bogus" }] }] })).toThrow();
  });
  it("parses a config with defaults applied", () => {
    const c = DemoConfigSchema.parse({ script: "DEMO.md", dashboardBaseUrl: "http://localhost:3000" });
    expect(c.fps).toBe(30); expect(c.resolution.width).toBe(1920);
  });
});
```
- [ ] **Step 2: Run → FAIL** `pnpm vitest run src/types.test.ts`
- [ ] **Step 3: Implement** `src/types.ts`
```typescript
import { z } from "zod";

export const ActionSchema = z.object({
  kind: z.enum(["goto", "click", "type", "wait", "hover", "highlight", "chapter"]),
  selector: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  ms: z.number().optional(),
  label: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

export const ShotSchema = z.object({
  id: z.string(),
  target: z.enum(["dashboard", "uipath", "terminal", "prebaked"]),
  narration: z.string(),
  actions: z.array(ActionSchema).default([]),
  url: z.string().optional(),
  clip: z.string().optional(), // prebaked clip path (target: "prebaked")
});
export type Shot = z.infer<typeof ShotSchema>;

export const ManifestSchema = z.object({ shots: z.array(ShotSchema).min(1) });
export type Manifest = z.infer<typeof ManifestSchema>;

export const DemoConfigSchema = z.object({
  script: z.string(),                         // path to DEMO_SCRIPT.md
  dashboardBaseUrl: z.string(),
  out: z.string().default("out"),
  resolution: z.object({ width: z.number(), height: z.number() }).default({ width: 1920, height: 1080 }),
  fps: z.number().default(30),
  voice: z.object({
    voiceId: z.string().default("21m00Tcm4TlvDq8ikWAM"), // ElevenLabs "Rachel" default; override per brand
    modelId: z.string().default("eleven_flash_v2_5"),
    seed: z.number().default(42),
    stability: z.number().default(0.5),
    similarity: z.number().default(0.75),
  }).default({}),
  theme: z.object({ captionFont: z.string().default("Arial"), captionSize: z.number().default(24), cursor: z.boolean().default(true) }).default({}),
  clipsDir: z.string().default("clips/prebaked"),
});
export type DemoConfig = z.infer<typeof DemoConfigSchema>;

export interface Alignment { chars: string[]; startSec: number[]; endSec: number[]; }
export interface TtsResult { shotId: string; audioPath: string; durationSec: number; alignment: Alignment; }
export interface TimelineEntry { shotId: string; startSec: number; durationSec: number; }
```
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat(types): manifest/config schemas + core types`

---

## Task 3: timeline.ts (PURE — offsets + pad-to-max)

**Files:** Create `src/timeline.ts`, `src/timeline.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { describe, it, expect } from "vitest";
import { buildTimeline, padToMax } from "./timeline";

describe("timeline", () => {
  it("computes cumulative offsets", () => {
    const t = buildTimeline([{ shotId: "a", durationSec: 2 }, { shotId: "b", durationSec: 3 }]);
    expect(t.entries.map(e => e.startSec)).toEqual([0, 2]);
    expect(t.totalSec).toBe(5);
  });
  it("padToMax returns the larger of audio vs action", () => {
    expect(padToMax(2, 3.5)).toBe(3.5);
    expect(padToMax(4, 1)).toBe(4);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `src/timeline.ts`
```typescript
import type { TimelineEntry } from "./types";

export function buildTimeline(shots: { shotId: string; durationSec: number }[]): { entries: TimelineEntry[]; totalSec: number } {
  let acc = 0;
  const entries: TimelineEntry[] = shots.map((s) => {
    const e: TimelineEntry = { shotId: s.shotId, startSec: acc, durationSec: s.durationSec };
    acc += s.durationSec;
    return e;
  });
  return { entries, totalSec: acc };
}

export function padToMax(audioSec: number, actionSec: number): number {
  return Math.max(audioSec, actionSec);
}
```
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: timeline offsets + pad-to-max`

---

## Task 4: fake-tts.ts (PURE — duration estimate + synthetic alignment)

**Files:** Create `src/fake-tts.ts`, `src/fake-tts.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { describe, it, expect } from "vitest";
import { estimateDurationSec, synthAlignment } from "./fake-tts";

describe("fake-tts", () => {
  it("estimates duration from word count with a floor", () => {
    expect(estimateDurationSec("one two three four five")).toBeCloseTo(5 * 0.38, 2);
    expect(estimateDurationSec("hi")).toBeGreaterThanOrEqual(1.0); // floor
  });
  it("synthesizes char-level alignment spanning the duration", () => {
    const a = synthAlignment("abc", 3);
    expect(a.chars).toEqual(["a", "b", "c"]);
    expect(a.startSec[0]).toBe(0);
    expect(a.endSec[2]).toBeCloseTo(3, 5);
    expect(a.endSec.every((e, i) => e > a.startSec[i]!)).toBe(true);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `src/fake-tts.ts`
```typescript
import type { Alignment } from "./types";
const SEC_PER_WORD = 0.38;
const FLOOR_SEC = 1.0;

export function estimateDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(FLOOR_SEC, words * SEC_PER_WORD);
}

export function synthAlignment(text: string, durationSec: number): Alignment {
  const chars = [...text];
  const n = Math.max(chars.length, 1);
  const per = durationSec / n;
  const startSec = chars.map((_, i) => +(i * per).toFixed(6));
  const endSec = chars.map((_, i) => +((i + 1) * per).toFixed(6));
  return { chars, startSec, endSec };
}
```
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: fake-tts duration estimate + synthetic alignment`

---

## Task 5: captions.ts (PURE — alignment → SRT)

**Files:** Create `src/captions.ts`, `src/captions.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { describe, it, expect } from "vitest";
import { toSrt } from "./captions";
import type { Alignment } from "./types";

const al = (text: string, dur: number): Alignment => {
  const chars = [...text]; const per = dur / chars.length;
  return { chars, startSec: chars.map((_, i) => i * per), endSec: chars.map((_, i) => (i + 1) * per) };
};

describe("toSrt", () => {
  it("emits SRT cues grouped into words, offset per shot", () => {
    const srt = toSrt([{ alignment: al("hi there", 2), startSec: 0 }, { alignment: al("bye", 1), startSec: 2 }]);
    expect(srt).toMatch(/^1\n00:00:00,000 --> /);          // first cue starts at 0
    expect(srt).toContain("hi there");
    expect(srt).toMatch(/\n\n3\n00:00:02,000 --> /);       // third cue offset by shot start 2s
    expect(srt.trim().endsWith("bye")).toBe(true);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `src/captions.ts`
```typescript
import type { Alignment } from "./types";

function fmt(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

// Group chars into words; each word cue spans its first char start -> last char end (+ shot offset).
function wordsFromAlignment(a: Alignment, offset: number): { start: number; end: number; text: string }[] {
  const cues: { start: number; end: number; text: string }[] = [];
  let cur = ""; let start = 0; let last = 0;
  const flush = () => { if (cur.trim()) cues.push({ start: start + offset, end: last + offset, text: cur.trim() }); cur = ""; };
  a.chars.forEach((c, i) => {
    if (cur === "") start = a.startSec[i]!;
    cur += c; last = a.endSec[i]!;
    if (/\s/.test(c)) flush();
  });
  flush();
  return cues;
}

export function toSrt(shots: { alignment: Alignment; startSec: number }[]): string {
  const cues = shots.flatMap((s) => wordsFromAlignment(s.alignment, s.startSec));
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join("\n\n") + "\n";
}
```
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: alignment -> SRT captions`

---

## Task 6: parse-script.ts (PURE — DEMO_SCRIPT.md → Manifest)

**Files:** Create `src/parse-script.ts`, `src/parse-script.test.ts`

**Format contract** (documented in README): shots are `### SHOT <id>` headings; under each, lines `- target: dashboard|uipath|terminal|prebaked`, optional `- url: ...`, optional `- clip: ...`, a `- narration: ...` line, and zero+ `- action: <kind> [selector="..."] [text="..."] [url="..."] [ms=NNN] [label="..."]` lines.

- [ ] **Step 1: Failing test**
```typescript
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
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `src/parse-script.ts`
```typescript
import { ManifestSchema, type Manifest, type Shot, type Action } from "./types";

function parseAction(rest: string): Action {
  const kind = rest.trim().split(/\s+/)[0] as Action["kind"];
  const attrs: Record<string, string> = {};
  for (const m of rest.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]!] = m[2]!;
  const msMatch = rest.match(/\bms=(\d+)/);
  return {
    kind,
    ...(attrs.selector ? { selector: attrs.selector } : {}),
    ...(attrs.text ? { text: attrs.text } : {}),
    ...(attrs.url ? { url: attrs.url } : {}),
    ...(attrs.label ? { label: attrs.label } : {}),
    ...(msMatch ? { ms: Number(msMatch[1]) } : {}),
  };
}

export function parseScript(md: string): Manifest {
  const shots: Shot[] = [];
  let cur: Partial<Shot> & { actions: Action[] } | null = null;
  const push = () => { if (cur && cur.id) shots.push({ id: cur.id, target: cur.target ?? "dashboard", narration: cur.narration ?? "", actions: cur.actions, ...(cur.url ? { url: cur.url } : {}), ...(cur.clip ? { clip: cur.clip } : {}) } as Shot); };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^###\s+SHOT\s+(\S+)/);
    if (h) { push(); cur = { id: h[1]!, actions: [] }; continue; }
    if (!cur) continue;
    const kv = line.match(/^-\s+(target|url|clip|narration):\s*(.*)$/);
    if (kv) { (cur as any)[kv[1]!] = kv[2]!.trim(); continue; }
    const act = line.match(/^-\s+action:\s*(.*)$/);
    if (act) { cur.actions.push(parseAction(act[1]!)); continue; }
  }
  push();
  return ManifestSchema.parse({ shots });
}
```
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: DEMO_SCRIPT.md parser`

---

## Task 7: ffmpeg.ts (PURE arg-builders + thin exec/probe)

**Files:** Create `src/ffmpeg.ts`, `src/ffmpeg.test.ts`

- [ ] **Step 1: Failing test** (builders are pure → assert arg arrays)
```typescript
import { describe, it, expect } from "vitest";
import { normalizeArgs, concatArgs, muxArgs, burnSubsArgs } from "./ffmpeg";

describe("ffmpeg arg builders", () => {
  it("normalize scales+pads to target and sets fps/h264", () => {
    const a = normalizeArgs("in.webm", "out.mp4", { width: 1920, height: 1080, fps: 30 });
    expect(a).toContain("-vf");
    expect(a.join(" ")).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(a.join(" ")).toContain("pad=1920:1080");
    expect(a.join(" ")).toContain("fps=30");
    expect(a).toContain("libx264");
    expect(a[a.length - 1]).toBe("out.mp4");
  });
  it("concat uses the demuxer with the list file", () => {
    expect(concatArgs("list.txt", "v.mp4").join(" ")).toContain("-f concat -safe 0 -i list.txt");
  });
  it("mux pairs video copy + aac audio, shortest", () => {
    const a = muxArgs("v.mp4", "a.mp3", "final.mp4").join(" ");
    expect(a).toContain("-c:v copy"); expect(a).toContain("-c:a aac"); expect(a).toContain("-shortest");
  });
  it("burn applies the subtitles filter", () => {
    expect(burnSubsArgs("v.mp4", "c.srt", "final.mp4").join(" ")).toContain("subtitles=c.srt");
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `src/ffmpeg.ts`
```typescript
import { spawn } from "node:child_process";

const BASE = ["-y", "-hide_banner", "-loglevel", "error"];

export function normalizeArgs(input: string, output: string, o: { width: number; height: number; fps: number }): string[] {
  const vf = `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2,fps=${o.fps},format=yuv420p`;
  return [...BASE, "-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", output];
}
export function concatArgs(listFile: string, output: string): string[] {
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output];
}
export function concatAudioArgs(listFile: string, output: string): string[] {
  return [...BASE, "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", output];
}
export function muxArgs(video: string, audio: string, output: string): string[] {
  return [...BASE, "-i", video, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-shortest", output];
}
export function burnSubsArgs(video: string, srt: string, output: string, style = "FontName=Arial,FontSize=24"): string[] {
  return [...BASE, "-i", video, "-vf", `subtitles=${srt}:force_style='${style}'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", output];
}
export function silentMp3Args(durationSec: number, output: string): string[] {
  return [...BASE, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(durationSec), "-c:a", "libmp3lame", output];
}

export function run(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${bin} exited ${code}: ${err.slice(0, 800)}`))));
  });
}
export const ffmpeg = (args: string[]) => run("ffmpeg", args);

export async function probeDurationSec(file: string): Promise<number> {
  return new Promise((res, rej) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = ""; p.stdout.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? res(parseFloat(out.trim())) : rej(new Error(`ffprobe ${file} exited ${c}`))));
  });
}
```
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: ffmpeg arg builders + exec/probe`

---

## Task 8: overlay.ts (PURE — injected fake-cursor/click/chapter layer)

**Files:** Create `src/overlay.ts`, `src/overlay.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { describe, it, expect } from "vitest";
import { overlayInitScript, moveCursorExpr, chapterExpr } from "./overlay";
describe("overlay", () => {
  it("init script defines the cursor + ripple + chapter API on window", () => {
    const s = overlayInitScript();
    expect(s).toContain("__demoCursor");
    expect(s).toContain("pointer-events: none");
    expect(s).toContain("__demoChapter");
  });
  it("move/chapter exprs reference the API", () => {
    expect(moveCursorExpr(10, 20)).toContain("__demoMove(10, 20)");
    expect(chapterExpr("Hello")).toContain("__demoChapter(\"Hello\")");
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `src/overlay.ts` — export `overlayInitScript(): string` returning a self-invoking script that, on load, injects a fixed-position cursor dot, a click-ripple element, and a chapter-title banner (all `position:fixed; pointer-events:none; z-index:2147483647`), and defines `window.__demoMove(x,y)`, `window.__demoClick()`, `window.__demoChapter(text)`, `window.__demoHighlight(selector)`. Plus `moveCursorExpr(x,y)`, `clickExpr()`, `chapterExpr(text)`, `highlightExpr(selector)` returning the JS expression strings to pass to `page.evaluate`. (This script is registered with `context.addInitScript` so it survives navigations.)
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: injected fake-cursor/overlay layer`

---

## Task 9: tts.ts (I/O — ElevenLabs OR fake; writes audio + returns duration+alignment)

**Files:** Create `src/tts.ts`, `src/tts.test.ts`

**Behavior:** `synthShot(shot, config, outDir): Promise<TtsResult>`.
- If `process.env.FAKE_TTS === "1"` (or no `ELEVENLABS_API_KEY`): `durationSec = estimateDurationSec(narration)`, `alignment = synthAlignment(...)`, write a silent mp3 via `ffmpeg(silentMp3Args(durationSec, audioPath))`. Deterministic, keyless.
- Else: `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/with-timestamps` with headers `xi-api-key`, body `{ text, model_id, seed, voice_settings:{stability,similarity_boost} }`; response has base64 `audio_base64` + `alignment.characters[]` + `character_start_times_seconds[]` + `character_end_times_seconds[]`. Write the mp3, map alignment, `durationSec = probeDurationSec(audioPath)`.

- [ ] **Step 1: Failing test** (FAKE path only — keyless)
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { synthShot } from "./tts";
import { DemoConfigSchema } from "./types";

describe("synthShot (FAKE_TTS)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("writes a silent mp3 and returns duration+alignment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tts-"));
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x" });
    const r = await synthShot({ id: "s1", target: "dashboard", narration: "hello world demo", actions: [] }, cfg, dir);
    expect(r.durationSec).toBeGreaterThan(0);
    expect(r.alignment.chars.length).toBeGreaterThan(0);
    expect((await stat(r.audioPath)).size).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2: Run → FAIL** (needs ffmpeg; available on this box)
- [ ] **Step 3: Implement** `src/tts.ts` per the behavior above (import `estimateDurationSec`/`synthAlignment` from `./fake-tts`, `silentMp3Args`/`ffmpeg`/`probeDurationSec` from `./ffmpeg`).
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: tts (ElevenLabs with-timestamps + FAKE_TTS path)`

---

## Task 10: verify.ts (PURE — parity assertions)

**Files:** Create `src/verify.ts`, `src/verify.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { describe, it, expect } from "vitest";
import { verifyParity } from "./verify";
describe("verifyParity", () => {
  it("passes when segment count matches and durations are within tolerance", () => {
    const r = verifyParity({ shotCount: 3, videoSegments: 3, audioSec: 30, videoSec: 30.2, maxSec: 300 });
    expect(r.ok).toBe(true);
  });
  it("fails on segment mismatch or overlength or A/V drift", () => {
    expect(verifyParity({ shotCount: 3, videoSegments: 2, audioSec: 30, videoSec: 30, maxSec: 300 }).ok).toBe(false);
    expect(verifyParity({ shotCount: 3, videoSegments: 3, audioSec: 30, videoSec: 30, maxSec: 25 }).ok).toBe(false);
    expect(verifyParity({ shotCount: 3, videoSegments: 3, audioSec: 30, videoSec: 33, maxSec: 300 }).ok).toBe(false);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `verifyParity({shotCount, videoSegments, audioSec, videoSec, maxSec})` → `{ ok, problems: string[] }`: segments must equal shotCount; `videoSec ≤ maxSec`; `abs(audioSec - videoSec) ≤ 1.5`. Collect problem strings.
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: parity verification`

---

## Task 11: config.ts + demo.config.sample.json

**Files:** Create `src/config.ts`, `src/config.test.ts`, `demo.config.sample.json`

- [ ] **Step 1: Failing test** — write a temp JSON, `loadConfig(path)` returns a parsed `DemoConfig` with defaults applied; a missing required field throws a clear error.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `loadConfig(path)`: read file, `JSON.parse`, `DemoConfigSchema.parse`, rethrow zod errors with the file path prefixed. Write `demo.config.sample.json` (script `./DEMO_SCRIPT.md`, dashboardBaseUrl `http://localhost:3000`, voice/theme blocks).
- [ ] **Step 4: Run → PASS**. **Step 5: Commit** — `feat: config loader + sample`

---

## Task 12: capture.ts (I/O — Playwright recordVideo driver)

**Files:** Create `src/capture.ts`, `tests/capture.smoke.test.ts`, `tests/fixtures/page.html`

**Behavior:** `captureShot(shot, timelineEntry, config, outDir): Promise<string>` (returns webm path).
- Launch chromium (headless), `newContext({ recordVideo: { dir: outDir, size: config.resolution }, viewport: config.resolution })`, `context.addInitScript(overlayInitScript())`, `page = context.newPage()`.
- `target: "prebaked"` → skip capture, return `shot.clip` path (caller treats as a ready segment).
- Else execute `shot.actions` in order, translating each to Playwright + an overlay call: `goto`→`page.goto(base+url)`; `click`→ move fake cursor to element box center, `__demoClick()`, then `page.click(selector)`; `type`→`page.locator(selector).pressSequentially(text)`; `highlight`→`__demoHighlight(selector)`; `chapter`→`__demoChapter(label)`; `wait`→`page.waitForTimeout(ms)`.
- After actions, **dwell** so total on-page time ≥ `timelineEntry.durationSec` (pad-to-max): `page.waitForTimeout(remainingMs)`.
- `context.close()` flushes the webm; return its path.

- [ ] **Step 1: Smoke test** (`tests/capture.smoke.test.ts`) — `FAKE_TTS=1`; serve/`file://` the `tests/fixtures/page.html` (a static page with `#bootstrap`, `#degraded` buttons); run `captureShot` for a shot with a goto+click and `durationSec: 2`; assert a `.webm` exists and is non-empty. (Requires `playwright install chromium` from Task 1.)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `capture.ts` per behavior. Use `page.locator(sel).boundingBox()` for cursor coordinates; guard missing elements with a clear error naming the selector + shot id.
- [ ] **Step 4: Run → PASS** `pnpm vitest run tests/capture.smoke.test.ts`
- [ ] **Step 5: Commit** — `feat: Playwright recordVideo capture driver`

---

## Task 13: pipeline.ts + cli.ts (orchestrate end-to-end)

**Files:** Create `src/pipeline.ts`, `src/cli.ts`, `tests/pipeline.smoke.test.ts`

**`runPipeline(config): Promise<{ outPath: string; report }>`:**
1. `parseScript(read(config.script))` → manifest.
2. For each shot (sequential — respect ElevenLabs concurrency): `synthShot` → `{durationSec, alignment, audioPath}`.
3. `buildTimeline(durations)`; `toSrt(shots+offsets)` → `out/captions.srt`.
4. For each shot: `captureShot` (or prebaked clip) → webm; `normalizeArgs` → `out/seg_<i>.mp4` (pad each segment to its `durationSec` with `-t`).
5. Write ffmpeg concat list for video segments → `concatArgs` → `out/video.mp4`; concat audio mp3s → `concatAudioArgs` → `out/audio.mp3`.
6. `muxArgs(video, audio)` → `out/muxed.mp4`; `burnSubsArgs(muxed, captions.srt)` → `out/final.mp4`.
7. `probeDurationSec` video+audio; `verifyParity(...)`; throw if `!ok`.

- [ ] **Step 1: Smoke test** (`tests/pipeline.smoke.test.ts`, `FAKE_TTS=1`) — a 2-shot DEMO_SCRIPT pointing at `file://tests/fixtures/page.html`; run `runPipeline`; assert `out/final.mp4` exists, non-empty, `probeDurationSec ≤ 300`, and `verifyParity.ok`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `pipeline.ts`; then `cli.ts`: `const cfg = loadConfig(process.argv[2] ?? "demo.config.json"); runPipeline(cfg).then(r => console.log("✓", r.outPath))`. Add `#!/usr/bin/env -S npx tsx` shebang.
- [ ] **Step 4: Run → PASS**; also `pnpm typecheck` clean.
- [ ] **Step 5: Commit** — `feat: end-to-end pipeline + CLI`

---

## Task 14: README + Claude Code skill + router registration

**Files:** Create `README.md`, `~/.claude/skills/demo-video/SKILL.md`; modify `~/.claude/skills/dan-skills/routing-table.md`

- [ ] **Step 1: README** — what it does; the manifest/DEMO_SCRIPT format; quickstart (`pnpm install && pnpm exec playwright install chromium`; `FAKE_TTS=1 pnpm demo demo.config.sample.json`); real render (`doppler run -p claude-code-use -c prd -- pnpm demo <config>`); the audio-first sync explanation; prebaked-clip workflow for third-party tabs.
- [ ] **Step 2: SKILL.md** — frontmatter `name: demo-video`, description (when to use: "produce a narrated demo video from a script + running app"); body = invoke the CLI with a config, how to author the DEMO_SCRIPT, FAKE_TTS for dry runs, Doppler for the real key, prebaked-clip guidance.
- [ ] **Step 3: Router** — add a `Make a demo video | demo-video` row to `~/.claude/skills/dan-skills/routing-table.md` (data plane) and a one-line authority note in `dan-skills/SKILL.md`.
- [ ] **Step 4: Commit** — `docs: README + demo-video skill + router registration`

---

## Definition of done

- `FAKE_TTS=1 pnpm test` green (unit + capture smoke + pipeline smoke); `pnpm typecheck` clean.
- `FAKE_TTS=1 pnpm demo demo.config.sample.json` produces `out/final.mp4` (silent, captioned) from the fixture page — proves the whole pipeline keyless.
- Real render path documented + ready: `doppler run -p claude-code-use -c prd -- pnpm demo <config>` (ElevenLabs narration).
- Skill registered; repo on a feature branch → PR.
- **Then (separate arc):** author `proctor.demo.config.json` + a Proctor `DEMO_SCRIPT` manifest, pre-capture the 3 UiPath clips, and render Proctor's real video → 100% coding-agent-built.
