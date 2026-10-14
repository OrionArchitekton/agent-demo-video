# Command TTS Provider and Word Aligner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agent-demo-video narrate with any operator-supplied voice command, with word timings from the voice, a word aligner, or the existing estimate, so real renders no longer require the hosted TTS service.

**Architecture:** A `voice.provider` switch in the config picks `elevenlabs` (unchanged default) or `command`. The command path runs an argv template with no shell, then resolves caption timing in order: words file written by the voice, then a configured aligner command, then the proportional estimate. Word timings are mapped onto the script's own words and converted to the per-character alignment the caption code already consumes. The render report gains a per-shot `narration[].timing` field.

**Tech Stack:** TypeScript (Node, zod, vitest), ffmpeg, optional Python faster-whisper for the reference aligner.

**Spec:** `specs/command-tts-provider-spec.md`

**Run tests with:** `env -u DISPLAY -u WAYLAND_DISPLAY pnpm test` (a dead X/Wayland display, for example WSLg with its compositor down, makes Playwright smoke tests hang; unsetting the display avoids it). Single file: `env -u DISPLAY -u WAYLAND_DISPLAY pnpm vitest run <path>`. Typecheck: `pnpm typecheck`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | `voice.provider`, `voice.command`, `voice.aligner`, `voice.timeoutSec` schema + validation; `TtsResult.timing` |
| `src/word-timing.ts` (create) | Map `{word,start,end}` timings onto the script's own words; interpolate misses; coverage; per-char alignment |
| `src/command-voice.ts` (create) | Fill argv placeholders, run a program without a shell (timeout, named errors), read and validate a words file |
| `src/tts.ts` (modify) | Provider-aware `resolveTtsMode`; `synthShot` command path; `timing` on every result |
| `src/provenance.ts` (modify) | `narration: [{shotId, timing}]` in the render report |
| `src/pipeline.ts` (modify) | Pass the provider to `resolveTtsMode`; warn on estimated timing; pass narration timings to the report |
| `tools/align_whisper.py` (create) | Reference aligner (faster-whisper, CPU) implementing the aligner contract |
| `tests/fixtures/voice/*.sh` (create) | Fixture voice commands: tone, tone + words, failing, slow, too short |
| `README.md` (modify) | "Use your own voice" section documenting the command and aligner contracts |

Outside the repo (Task 9): the operator's own voice adapter, which is never committed here.

---

### Task 1: Voice provider config

**Files:**
- Modify: `src/types.ts` (the `voice: z.object({...}).strict().default({})` block)
- Test: `src/types.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `src/types.test.ts`)

```ts
describe("voice provider config (specs/command-tts-provider-spec.md)", () => {
  const base = { script: "x", dashboardBaseUrl: "http://x" };
  it("defaults to the hosted provider with no command", () => {
    const c = DemoConfigSchema.parse(base);
    expect(c.voice.provider).toBe("elevenlabs");
    expect(c.voice.command).toBeUndefined();
    expect(c.voice.timeoutSec).toBe(600);
  });
  it("requires voice.command for the command provider", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { provider: "command" } })).toThrowError(/voice\.command/);
  });
  it("requires {text} and {out} placeholders in the command", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { provider: "command", command: ["tts", "{text}"] } }))
      .toThrowError(/\{out\}/);
  });
  it("requires {audio}, {text} and {out} placeholders in the aligner", () => {
    expect(() => DemoConfigSchema.parse({ ...base, voice: { provider: "command", command: ["tts", "{text}", "{out}"], aligner: ["al", "{audio}", "{out}"] } }))
      .toThrowError(/\{text\}/);
  });
  it("accepts a command voice with an aligner", () => {
    const c = DemoConfigSchema.parse({ ...base, voice: { provider: "command", command: ["tts", "--text-file", "{text}", "--out", "{out}"], aligner: ["python3", "tools/align_whisper.py", "{audio}", "{text}", "{out}"], timeoutSec: 120 } });
    expect(c.voice.command).toEqual(["tts", "--text-file", "{text}", "--out", "{out}"]);
    expect(c.voice.timeoutSec).toBe(120);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/types.test.ts`
Expected: FAIL (`provider` undefined; command configs rejected by `.strict()`).

- [ ] **Step 3: Implement** (replace the `voice` block in `src/types.ts`)

```ts
  voice: z.object({
    // specs/command-tts-provider-spec.md: "elevenlabs" (hosted, default) or
    // "command" (an operator-supplied program run once per shot, no shell).
    provider: z.enum(["elevenlabs", "command"]).default("elevenlabs"),
    // argv template; {text} = path of a file holding the shot's narration,
    // {out} = audio path the program must write.
    command: z.array(z.string().min(1)).min(1).optional(),
    // argv template; {audio} = finished narration, {text} = narration file,
    // {out} = JSON path for [{word,start,end}] the program must write.
    aligner: z.array(z.string().min(1)).min(1).optional(),
    timeoutSec: z.number().positive().default(600),
    voiceId: z.string().default("21m00Tcm4TlvDq8ikWAM"),
    // Quality tier by default (production-polish S6): flash is the latency
    // tier and audibly flatter for narration. Explicit config still wins.
    modelId: z.string().default("eleven_multilingual_v2"),
    seed: z.number().default(42),
    stability: z.number().default(0.5),
    similarity: z.number().default(0.75),
  }).strict().superRefine((v, ctx) => {
    const need = (field: "command" | "aligner", argv: string[] | undefined, holders: string[]) => {
      if (!argv) return;
      for (const h of holders) {
        if (!argv.some((a) => a.includes(h))) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `voice.${field} must contain the ${h} placeholder` });
        }
      }
    };
    if (v.provider === "command" && !v.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["command"], message: 'voice.provider "command" needs voice.command (an argument list using {text} and {out})' });
    }
    need("command", v.command, ["{text}", "{out}"]);
    need("aligner", v.aligner, ["{audio}", "{text}", "{out}"]);
  }).default({}),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run src/types.test.ts && pnpm typecheck`
Expected: PASS. If `pnpm typecheck` reports that `voice` is now a `ZodEffects` where an object shape was expected (for example a `.shape.voice` access), change that access to `DemoConfig["voice"]` typing instead.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: voice.provider config (elevenlabs default, command) with placeholder validation"
```

---

### Task 2: Provider-aware narration mode

**Files:**
- Modify: `src/tts.ts` (`resolveTtsMode`), `src/pipeline.ts:1084`
- Test: `src/tts.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `src/tts.test.ts`)

```ts
describe("resolveTtsMode with the command provider", () => {
  it("needs no hosted key for a command voice", () => {
    expect(resolveTtsMode({}, "command")).toBe("real");
  });
  it("still honours an explicit fake request", () => {
    expect(resolveTtsMode({ FAKE_TTS: "1" }, "command")).toBe("fake");
  });
  it("still requires the hosted key for the default provider", () => {
    expect(() => resolveTtsMode({}, "elevenlabs")).toThrowError(/ELEVENLABS_API_KEY/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/tts.test.ts -t "command provider"`
Expected: FAIL (`resolveTtsMode({}, "command")` throws the key error).

- [ ] **Step 3: Implement** (in `src/tts.ts`)

```ts
export function resolveTtsMode(
  env: { FAKE_TTS?: string; ELEVENLABS_API_KEY?: string } = process.env,
  provider: DemoConfig["voice"]["provider"] = "elevenlabs",
): TtsMode {
  if (env.FAKE_TTS === "1") return "fake";
  if (provider === "command") return "real";
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set, so narration cannot be synthesised. " +
        "Supply it from your secret manager (e.g. `doppler run -- pnpm demo <config>`), " +
        "use voice.provider \"command\" with your own voice command, " +
        "or set FAKE_TTS=1 to deliberately render silent placeholder narration.",
    );
  }
  return "real";
}
```

In `src/pipeline.ts`, change `const ttsMode = resolveTtsMode();` to `const ttsMode = resolveTtsMode(process.env, config.voice.provider);`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/tts.test.ts && pnpm typecheck`
Expected: PASS (existing precedence tests still pass because `provider` defaults to `"elevenlabs"`).

- [ ] **Step 5: Commit**

```bash
git add src/tts.ts src/pipeline.ts src/tts.test.ts
git commit -m "feat: resolveTtsMode is provider-aware; a command voice needs no hosted key"
```

---

### Task 3: Map word timings onto the script

**Files:**
- Create: `src/word-timing.ts`
- Test: `src/word-timing.test.ts`

- [ ] **Step 1: Write the failing tests** (`src/word-timing.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { alignScriptWords, MIN_COVERAGE } from "./word-timing";

describe("alignScriptWords", () => {
  it("keeps the script's spelling and uses the recognizer only for times", () => {
    const { alignment, coverage } = alignScriptWords("Use A.I. today", [
      { word: "use", start: 0, end: 0.3 }, { word: "AI", start: 0.35, end: 0.7 }, { word: "today.", start: 0.75, end: 1.2 },
    ], 1.5);
    expect(alignment.chars.join("")).toBe("Use A.I. today");
    expect(coverage).toBe(1);
    expect(alignment.startSec[4]).toBe(0.35); // the "A" of "A.I."
  });
  it("interpolates a word the timings missed between its neighbours", () => {
    const { alignment, coverage } = alignScriptWords("one two three", [
      { word: "one", start: 0, end: 0.4 }, { word: "three", start: 1.0, end: 1.4 },
    ], 1.5);
    expect(coverage).toBeCloseTo(2 / 3);
    const twoStart = alignment.startSec["one ".length]!;
    expect(twoStart).toBeGreaterThanOrEqual(0.4);
    expect(twoStart).toBeLessThan(1.0);
  });
  it("produces one non-decreasing time per character", () => {
    const text = "Paste only what the task needs.";
    const { alignment } = alignScriptWords(text, [
      { word: "paste", start: 0, end: 0.3 }, { word: "only", start: 0.3, end: 0.5 },
      { word: "what", start: 0.5, end: 0.7 }, { word: "the", start: 0.7, end: 0.8 },
      { word: "task", start: 0.8, end: 1.0 }, { word: "needs", start: 1.0, end: 1.3 },
    ], 1.4);
    expect(alignment.chars.length).toBe(text.length);
    for (let i = 1; i < text.length; i++) expect(alignment.startSec[i]!).toBeGreaterThanOrEqual(alignment.startSec[i - 1]!);
  });
  it("reports low coverage so the caller can refuse a wrong take", () => {
    const { coverage } = alignScriptWords("alpha beta gamma delta", [{ word: "zzz", start: 0, end: 1 }], 2);
    expect(coverage).toBeLessThan(MIN_COVERAGE);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/word-timing.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`src/word-timing.ts`)

```ts
import type { Alignment } from "./types";

/** One timed word from a voice command or an aligner, seconds relative to the shot's audio. */
export interface TimedWord { word: string; start: number; end: number; }

/** Below this share of script words matched, the take is treated as wrong or truncated. */
export const MIN_COVERAGE = 0.6;

const key = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
const LOOKAHEAD = 4;

/**
 * Map timed words onto the script's OWN words (captions never show recognizer spelling),
 * interpolate words the timings missed between their neighbours, and expand to the
 * per-character alignment the caption builder consumes.
 */
export function alignScriptWords(text: string, timed: TimedWord[], durationSec: number): { alignment: Alignment; coverage: number } {
  const tokens = [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], index: m.index! }));
  const times: ({ start: number; end: number } | null)[] = tokens.map(() => null);
  let j = 0;
  tokens.forEach((t, i) => {
    const k = key(t.word);
    if (!k) return;
    for (let look = j; look < Math.min(timed.length, j + LOOKAHEAD); look++) {
      if (key(timed[look]!.word) === k) {
        times[i] = { start: timed[look]!.start, end: timed[look]!.end };
        j = look + 1;
        return;
      }
    }
  });
  const countable = tokens.filter((t) => key(t.word)).length || 1;
  const coverage = times.filter(Boolean).length / countable;

  // Interpolate each run of unknown tokens evenly between the known neighbours.
  let i = 0;
  while (i < tokens.length) {
    if (times[i]) { i++; continue; }
    let k = i;
    while (k < tokens.length && !times[k]) k++;
    const from = i > 0 ? times[i - 1]!.end : 0;
    const to = k < tokens.length ? times[k]!.start : durationSec;
    const step = Math.max(to - from, 0) / (k - i);
    for (let n = i; n < k; n++) times[n] = { start: from + step * (n - i), end: from + step * (n - i + 1) };
    i = k;
  }

  const chars = [...text];
  const startSec: number[] = new Array(chars.length);
  const endSec: number[] = new Array(chars.length);
  let cursor = 0;
  tokens.forEach((t, ti) => {
    const { start, end } = times[ti]!;
    for (let c = cursor; c < t.index; c++) { startSec[c] = start; endSec[c] = start; } // whitespace before the word
    const n = t.word.length;
    for (let c = 0; c < n; c++) {
      startSec[t.index + c] = +(start + ((end - start) * c) / n).toFixed(6);
      endSec[t.index + c] = +(start + ((end - start) * (c + 1)) / n).toFixed(6);
    }
    cursor = t.index + n;
  });
  const last = tokens.length ? times[tokens.length - 1]!.end : 0;
  for (let c = cursor; c < chars.length; c++) { startSec[c] = last; endSec[c] = last; }
  return { alignment: { chars, startSec, endSec }, coverage };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/word-timing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/word-timing.ts src/word-timing.test.ts
git commit -m "feat: map voice/aligner word timings onto the script's own words"
```

---

### Task 4: Run a voice or aligner command

**Files:**
- Create: `src/command-voice.ts`, `tests/fixtures/voice/tone.sh`, `tests/fixtures/voice/tone-words.sh`, `tests/fixtures/voice/fail.sh`, `tests/fixtures/voice/slow.sh`, `tests/fixtures/voice/short.sh`, `tests/fixtures/voice/align-even.sh`, `tests/fixtures/voice/align-wrong.sh`
- Test: `src/command-voice.test.ts`

- [ ] **Step 1: Create the fixture commands** (all `chmod +x`; args are `--text-file TEXT --out OUT`)

`tests/fixtures/voice/tone.sh`:
```bash
#!/usr/bin/env bash
# Fixture voice command: ignores the words, writes a 1.5 s tone. No word timings.
set -euo pipefail
[ -s "$2" ] || { echo "empty narration file" >&2; exit 2; }
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1.5" "$4"
```

`tests/fixtures/voice/tone-words.sh`:
```bash
#!/usr/bin/env bash
# Fixture voice command: 1.5 s tone plus evenly spaced word timings in <out>.words.json.
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1.5" "$4"
python3 -c '
import json, sys
words = open(sys.argv[1]).read().split()
step = 1.5 / max(len(words), 1)
json.dump([{"word": w, "start": round(i * step, 3), "end": round((i + 1) * step, 3)} for i, w in enumerate(words)], open(sys.argv[2], "w"))
' "$2" "$4.words.json"
```

`tests/fixtures/voice/fail.sh`:
```bash
#!/usr/bin/env bash
echo "voice model not loaded" >&2
exit 3
```

`tests/fixtures/voice/slow.sh`:
```bash
#!/usr/bin/env bash
sleep 5
```

`tests/fixtures/voice/align-even.sh` (aligner fixture; args `{audio} {text} {out}`):
```bash
#!/usr/bin/env bash
# Fixture aligner: evenly spaced timings for the narration's words, 0.2 s each.
set -euo pipefail
python3 -c '
import json, sys
words = open(sys.argv[1]).read().split()
json.dump([{"word": w, "start": round(i * 0.2, 3), "end": round(i * 0.2 + 0.2, 3)} for i, w in enumerate(words)], open(sys.argv[2], "w"))
' "$2" "$3"
```

`tests/fixtures/voice/align-wrong.sh` (aligner fixture; a take that matches nothing):
```bash
#!/usr/bin/env bash
set -euo pipefail
echo '[{"word": "zzz", "start": 0, "end": 1}]' > "$3"
```

`tests/fixtures/voice/short.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=0.1" "$4"
```

- [ ] **Step 2: Write the failing tests** (`src/command-voice.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fillArgs, runCommand, readWordsFile } from "./command-voice";

const fx = (n: string) => resolve("tests/fixtures/voice", n);

describe("fillArgs", () => {
  it("substitutes known placeholders and leaves unknown ones", () => {
    expect(fillArgs(["tts", "--in={text}", "{out}", "{nope}"], { text: "/t", out: "/o" })).toEqual(["tts", "--in=/t", "/o", "{nope}"]);
  });
});

describe("runCommand", () => {
  it("names a missing program", async () => {
    await expect(runCommand("voice command (shot s1)", ["/no/such/tts"], {}, 5)).rejects.toThrowError(/voice command \(shot s1\): program not found/);
  });
  it("names a non-zero exit and keeps the stderr tail", async () => {
    await expect(runCommand("voice command (shot s1)", [fx("fail.sh")], {}, 5)).rejects.toThrowError(/exited 3: voice model not loaded/);
  });
  it("names a timeout", async () => {
    await expect(runCommand("voice command (shot s1)", [fx("slow.sh")], {}, 1)).rejects.toThrowError(/timed out after 1s/);
  });
});

describe("readWordsFile", () => {
  it("returns null when the file is absent", async () => {
    expect(await readWordsFile("/no/such/words.json", "x")).toBeNull();
  });
  it("rejects malformed timings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "words-"));
    const p = join(dir, "w.json");
    await writeFile(p, JSON.stringify([{ word: "a", start: 1, end: 0.5 }]));
    await expect(readWordsFile(p, "voice command (shot s1)")).rejects.toThrowError(/voice command \(shot s1\): malformed word timings/);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/command-voice.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement** (`src/command-voice.ts`)

```ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { TimedWord } from "./word-timing";

/** Substitute {name} placeholders in an argv template; unknown placeholders are left as is. */
export function fillArgs(template: string[], vars: Record<string, string>): string[] {
  return template.map((a) => a.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m)));
}

/** Run an operator-supplied program WITHOUT a shell; every failure names `label` and its cause. */
export async function runCommand(label: string, template: string[], vars: Record<string, string>, timeoutSec: number): Promise<void> {
  const [prog, ...args] = fillArgs(template, vars);
  await new Promise<void>((resolveRun, reject) => {
    execFile(prog!, args, { timeout: timeoutSec * 1000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) return resolveRun();
      const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
      if (e.code === "ENOENT") return reject(new Error(`${label}: program not found: ${prog}`));
      if (e.killed) return reject(new Error(`${label}: timed out after ${timeoutSec}s`));
      reject(new Error(`${label}: exited ${e.code}: ${String(stderr).trim().slice(-400)}`));
    });
  });
}

/** Read [{word,start,end}] timings; null when the file is absent, an error when it is malformed. */
export async function readWordsFile(path: string, label: string): Promise<TimedWord[] | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error(`${label}: malformed word timings in ${path} (not JSON)`); }
  const ok = Array.isArray(data) && data.every((w) =>
    w && typeof w.word === "string" && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end >= w.start);
  if (!ok) throw new Error(`${label}: malformed word timings in ${path} (need [{word, start, end}] with 0 <= start <= end)`);
  return data as TimedWord[];
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/command-voice.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/command-voice.ts src/command-voice.test.ts tests/fixtures/voice
git commit -m "feat: run voice/aligner commands without a shell; validate word timings files"
```

---

### Task 5: Command path in synthShot, with timing source

**Files:**
- Modify: `src/types.ts:289` (`TtsResult`), `src/tts.ts` (`synthShot`)
- Test: `src/tts.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `src/tts.test.ts`)

```ts
import { resolve } from "node:path";

describe("synthShot with a command voice", () => {
  const shot = { id: "s1", target: "dashboard" as const, narration: "Paste only what the task needs.", actions: [] };
  const fx = (n: string) => resolve("tests/fixtures/voice", n);
  const cfgWith = (voice: Record<string, unknown>) =>
    DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://x", voice: { provider: "command", timeoutSec: 30, ...voice } });
  const run = async (voice: Record<string, unknown>) =>
    synthShot(shot, cfgWith(voice), await mkdtemp(join(tmpdir(), "cmdtts-")));
  beforeEach(() => { delete process.env.FAKE_TTS; });

  it("uses the command's audio and estimates timing when no words and no aligner", async () => {
    const r = await run({ command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"] });
    expect(r.timing).toBe("estimated");
    expect(r.durationSec).toBeGreaterThan(1.4);
    expect(r.alignment.chars.join("")).toBe(shot.narration);
  });
  it("uses the command's own word timings when it writes them", async () => {
    const r = await run({ command: [fx("tone-words.sh"), "--text-file", "{text}", "--out", "{out}"] });
    expect(r.timing).toBe("provider");
    expect(r.alignment.startSec[0]).toBe(0);
  });
  it("runs the aligner when the command writes no timings", async () => {
    const r = await run({
      command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-even.sh"), "{audio}", "{text}", "{out}"],
    });
    expect(r.timing).toBe("aligned");
  });
  it("stops on audio shorter than 0.3 s", async () => {
    await expect(run({ command: [fx("short.sh"), "--text-file", "{text}", "--out", "{out}"] }))
      .rejects.toThrowError(/voice command \(shot s1\): audio is 0\.1\d*s/);
  });
  it("stops when a configured aligner fails, never falling back silently", async () => {
    await expect(run({ command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"], aligner: [fx("fail.sh"), "{audio}", "{text}", "{out}"] }))
      .rejects.toThrowError(/aligner \(shot s1\): exited 3/);
  });
  it("stops when timings match under 60% of the script's words", async () => {
    await expect(run({
      command: [fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"],
      aligner: [fx("align-wrong.sh"), "{audio}", "{text}", "{out}"],
    })).rejects.toThrowError(/aligner \(shot s1\): word timings match only \d+% of the script's words/);
  });
});
```

Add `beforeEach` to the vitest import at the top of the file: `import { describe, it, expect, beforeAll, beforeEach } from "vitest";`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/tts.test.ts -t "command voice"`
Expected: FAIL (synthShot calls the hosted service; `timing` undefined).

- [ ] **Step 3: Implement**

In `src/types.ts` replace the `TtsResult` line:
```ts
export type TimingSource = "provider" | "aligned" | "estimated";
export interface TtsResult { shotId: string; audioPath: string; durationSec: number; alignment: Alignment; timing?: TimingSource; }
```

In `src/tts.ts`: REPLACE the existing `import { mkdir, writeFile } from "node:fs/promises";` line with the first import below, add the other imports, add the command path, and set `timing` on the existing paths.
```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { runCommand, readWordsFile } from "./command-voice";
import { alignScriptWords, MIN_COVERAGE } from "./word-timing";
import type { TimingSource } from "./types";

const MIN_AUDIO_SEC = 0.3;

async function synthCommandShot(shot: Shot, config: DemoConfig, outDir: string): Promise<TtsResult> {
  const v = config.voice;
  const label = `voice command (shot ${shot.id})`;
  const audioPath = join(outDir, `${shot.id}.wav`);
  const textPath = join(outDir, `${shot.id}.txt`);
  await writeFile(textPath, shot.narration, "utf8");
  await rm(audioPath, { force: true });
  await rm(`${audioPath}.words.json`, { force: true });
  await runCommand(label, v.command!, { text: textPath, out: audioPath }, v.timeoutSec);
  if (!existsSync(audioPath)) throw new Error(`${label}: wrote no audio at ${audioPath}`);
  const durationSec = await probeDurationSec(audioPath);
  if (!(durationSec >= MIN_AUDIO_SEC)) throw new Error(`${label}: audio is ${durationSec}s, under the ${MIN_AUDIO_SEC}s minimum`);

  let words = await readWordsFile(`${audioPath}.words.json`, label);
  let timing: TimingSource = "provider";
  let source = label;
  if (!words && v.aligner) {
    source = `aligner (shot ${shot.id})`;
    const wordsPath = join(outDir, `${shot.id}.aligned.json`);
    await rm(wordsPath, { force: true });
    await runCommand(source, v.aligner, { audio: audioPath, text: textPath, out: wordsPath }, v.timeoutSec);
    words = await readWordsFile(wordsPath, source);
    if (!words) throw new Error(`${source}: wrote no word timings at ${wordsPath}`);
    timing = "aligned";
  }
  if (!words) {
    return { shotId: shot.id, audioPath, durationSec, alignment: synthAlignment(shot.narration, durationSec), timing: "estimated" };
  }
  const { alignment, coverage } = alignScriptWords(shot.narration, words, durationSec);
  if (coverage < MIN_COVERAGE) {
    throw new Error(`${source}: word timings match only ${Math.round(coverage * 100)}% of the script's words (need ${MIN_COVERAGE * 100}%); wrong or truncated take?`);
  }
  return { shotId: shot.id, audioPath, durationSec, alignment, timing };
}
```

In `synthShot`: the fake branch returns `{ ..., alignment, timing: "estimated" }`; directly after the fake branch add
```ts
  if (config.voice.provider === "command") return synthCommandShot(shot, config, outDir);
```
and the hosted branch's final return becomes `return { shotId: shot.id, audioPath, durationSec, alignment, timing: "provider" };`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run src/tts.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/tts.ts src/tts.test.ts
git commit -m "feat: command voice path in synthShot with provider > aligner > estimate timing"
```

---

### Task 6: Report per-shot timing and warn on estimates

**Files:**
- Modify: `src/provenance.ts` (`RenderReport`, `buildRenderReport`), `src/pipeline.ts` (after the TTS loop; the `buildRenderReport({...})` call)
- Test: `src/provenance.test.ts`

- [ ] **Step 1: Write the failing tests** (add inside the existing `describe("buildRenderReport", ...)` in `src/provenance.test.ts`, where the `base` fixture is in scope)

```ts
  it("records the caption timing source per shot (specs/command-tts-provider-spec.md)", () => {
    const r = buildRenderReport({ ...base, narration: [{ shotId: "s1", timing: "aligned" as const }, { shotId: "s2", timing: "estimated" as const }] });
    expect(r.narration).toEqual([{ shotId: "s1", timing: "aligned" }, { shotId: "s2", timing: "estimated" }]);
  });

  it("omits narration timing when no shot reported it", () => {
    expect("narration" in buildRenderReport(base)).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/provenance.test.ts`
Expected: FAIL (`narration` not in the report).

- [ ] **Step 3: Implement**

`src/provenance.ts`: add to `RenderReport` and to `buildRenderReport`'s parameter type
```ts
  /** Per-shot caption timing source (specs/command-tts-provider-spec.md). */
  narration?: { shotId: string; timing: TimingSource }[];
```
import `TimingSource` from `./types`, and in the returned object add
```ts
    ...(o.narration && o.narration.length ? { narration: o.narration } : {}),
```

`src/pipeline.ts`, directly after the TTS loop:
```ts
  const estimated = ttsResults.filter((t) => t.timing === "estimated").map((t) => t.shotId);
  if (config.voice.provider === "command" && estimated.length) {
    console.warn(
      `[agent-demo-video] estimated caption timing for ${estimated.length} shot(s) (${estimated.join(", ")}): ` +
        "the voice command wrote no word timings and no voice.aligner is configured",
    );
  }
```
and in the `buildRenderReport({...})` call add
```ts
      narration: ttsResults.filter((t) => t.timing).map((t) => ({ shotId: t.shotId, timing: t.timing! })),
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/provenance.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/provenance.ts src/provenance.test.ts src/pipeline.ts
git commit -m "feat: render report records per-shot caption timing; warn on estimated command timing"
```

---

### Task 7: End-to-end smoke with a command voice

**Files:**
- Create: `tests/command-voice.smoke.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

const fx = (n: string) => resolve("tests/fixtures/voice", n);

async function render(command: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "cmdvoice-"));
  const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
  const scriptPath = join(dir, "demo.md");
  await writeFile(scriptPath, (await readFile(resolve("tests/fixtures/demo.md"), "utf8")).replaceAll("FIXTURE_URL", fixture));
  const cfg = DemoConfigSchema.parse({
    script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"),
    resolution: { width: 1280, height: 720 }, voice: { provider: "command", command, timeoutSec: 60 },
  });
  const r = await runPipeline(cfg, { requireFreshOut: true });
  const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
  return { r, report };
}

describe("runPipeline with a command voice (smoke, no hosted key)", () => {
  beforeEach(() => { delete process.env.FAKE_TTS; delete process.env.ELEVENLABS_API_KEY; });

  it("AC2: renders with estimated timing when the voice writes no timings", async () => {
    const { r, report } = await render([fx("tone.sh"), "--text-file", "{text}", "--out", "{out}"]);
    expect(r.report.parity.ok).toBe(true);
    expect(report.ttsMode).toBe("real");
    expect(report.voice.provider).toBe("command");
    expect(report.narration.every((n: { timing: string }) => n.timing === "estimated")).toBe(true);
  });

  it("AC3: reports provider timing when the voice writes word timings", async () => {
    const { report } = await render([fx("tone-words.sh"), "--text-file", "{text}", "--out", "{out}"]);
    expect(report.narration.every((n: { timing: string }) => n.timing === "provider")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `env -u DISPLAY -u WAYLAND_DISPLAY pnpm vitest run tests/command-voice.smoke.test.ts`
Expected: PASS (2 tests). If a fixture tone is shorter than a shot's capture, the pipeline pads audio as it already does for short narration; do not change padding.

- [ ] **Step 3: Run the whole suite (AC1: nothing else changed)**

Run: `env -u DISPLAY -u WAYLAND_DISPLAY pnpm test && pnpm typecheck`
Expected: all previous 356 tests still pass, plus the new ones.

- [ ] **Step 4: Commit**

```bash
git add tests/command-voice.smoke.test.ts
git commit -m "test: end-to-end command-voice renders (estimated and provider timing)"
```

---

### Task 8: Reference aligner and README

**Files:**
- Create: `tools/align_whisper.py`, `tests/align-whisper.test.ts`
- Modify: `README.md` (new section after the voice configuration section)

- [ ] **Step 1: Write the opt-in test** (`tests/align-whisper.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Opt-in: ALIGN_PY = a python with faster-whisper; ALIGN_AUDIO = a speech file; ALIGN_TEXT = its words.
const py = process.env.ALIGN_PY, audio = process.env.ALIGN_AUDIO, text = process.env.ALIGN_TEXT;

describe.skipIf(!py || !audio || !text)("tools/align_whisper.py (opt-in)", () => {
  it("writes [{word,start,end}] for real speech", async () => {
    const dir = await mkdtemp(join(tmpdir(), "align-"));
    const textPath = join(dir, "t.txt"), out = join(dir, "w.json");
    await writeFile(textPath, text!);
    execFileSync(py!, [resolve("tools/align_whisper.py"), audio!, textPath, out], { stdio: "inherit" });
    const words = JSON.parse(await readFile(out, "utf8"));
    expect(words.length).toBeGreaterThan(3);
    expect(words.every((w: { start: number; end: number }) => w.end >= w.start)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement** (`tools/align_whisper.py`)

```python
#!/usr/bin/env python3
"""Reference aligner for agent-demo-video's command voice provider (specs/command-tts-provider-spec.md).

Usage: align_whisper.py <audio> <text-file> <out.json>
Writes [{"word", "start", "end"}] from faster-whisper word timestamps on CPU. The pipeline maps
these onto the script's own words, so recognizer spelling never reaches the captions; the script
text is passed as a prompt only to steer recognition.
Env: ALIGN_MODEL (default small.en), ALIGN_THREADS (default 4).
"""
import json
import os
import sys

from faster_whisper import WhisperModel

audio, text_path, out = sys.argv[1:4]
script = open(text_path, encoding="utf-8").read()
model = WhisperModel(os.environ.get("ALIGN_MODEL", "small.en"), device="cpu", compute_type="int8",
                     cpu_threads=int(os.environ.get("ALIGN_THREADS", "4")))
segments, _ = model.transcribe(audio, word_timestamps=True, initial_prompt=script[:200])
words = [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
         for s in segments for w in (s.words or []) if w.word.strip()]
with open(out, "w", encoding="utf-8") as f:
    json.dump(words, f)
```

- [ ] **Step 3: Add the README section**

````markdown
## Use your own voice (command provider)

Any TTS you can run from a shell can narrate. Set `voice.provider` to `"command"` and give an
argument list; `{text}` is a file holding the shot's narration and `{out}` is where your program
must write audio (any format ffmpeg reads). No shell is involved.

```json
"voice": {
  "provider": "command",
  "command": ["my-tts", "--text-file", "{text}", "--out", "{out}"],
  "aligner": ["python3", "tools/align_whisper.py", "{audio}", "{text}", "{out}"],
  "timeoutSec": 600
}
```

Word-pop captions need word timings. They come from, in order: a `{out}.words.json` your command
writes (`[{"word", "start", "end"}]`, seconds), the optional `aligner` (the bundled
`tools/align_whisper.py` needs `pip install faster-whisper`), or a proportional estimate. The
render report records which one each shot used (`narration[].timing`), and the run warns when any
shot was estimated. A failing command or aligner, a timeout, audio under 0.3 s, or timings that
match under 60% of the script's words stop the render with the shot and the cause.
````

- [ ] **Step 4: Run tests**

Run: `env -u DISPLAY -u WAYLAND_DISPLAY pnpm test && pnpm typecheck`
Expected: PASS (the aligner test is skipped without its env vars; `tests/readme.smoke.test.ts` only regex-checks other README sections, so the new section cannot break it).

- [ ] **Step 5: Commit**

```bash
git add tools/align_whisper.py tests/align-whisper.test.ts README.md
git commit -m "feat: reference faster-whisper aligner and README for the command voice"
```

---

### Task 9: Operator proof (outside the repo)

**Files:** none in this repository. The operator keeps their own voice adapter (any local TTS wrapped to the `--text-file TEXT --out OUT` contract) outside the repo, because it carries machine-specific paths and, for a cloned voice, personal voice material.

- [ ] **Step 1: Write an operator adapter** that reads the narration file, synthesizes it with the operator's TTS, and writes audio to the output path. It writes no word timings, so the aligner supplies them.
- [ ] **Step 2: Render the fixture demo (AC6)** with `voice.provider: "command"`, the adapter as `voice.command`, and `tools/align_whisper.py` (run with a Python that has faster-whisper) as `voice.aligner`. Expected: `final.mp4`, `render-report.json` with every `narration[].timing` = `aligned`, deliverable verify `ok`.
- [ ] **Step 3: Check sync and speech:** captions present on every contact-sheet tile, and a transcription of `final.mp4` matches the narration. Record the results in the PR description under "AC6 operator evidence" without machine paths.

---

## Self-review notes

- Spec coverage: scenario 1 -> Tasks 1, 2, 7 (AC1 full suite); 2 -> Tasks 4, 5, 7; 3 -> Tasks 3, 5; 4 -> Tasks 4, 5 (AC5); 5 -> Task 6, 7; 6 -> Task 8; AC6 -> Task 9.
- Names used consistently: `TimedWord`, `alignScriptWords`, `MIN_COVERAGE`, `fillArgs`, `runCommand`, `readWordsFile`, `TimingSource`, `synthCommandShot`, `narration[].timing`.
