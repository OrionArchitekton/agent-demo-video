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
  }, 600_000);
});

describe("tools/align_whisper.py with a stubbed recognizer", () => {
  it("skips words whose start or end is None", async () => {
    const dir = await mkdtemp(join(tmpdir(), "align-stub-"));
    const textPath = join(dir, "t.txt"), out = join(dir, "w.json");
    await writeFile(textPath, "Hello lost half world");
    execFileSync("python3", [resolve("tools/align_whisper.py"), "unused.wav", textPath, out], {
      env: { ...process.env, PYTHONPATH: resolve("tests/fixtures/stub-whisper") },
    });
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual([
      { word: "Hello", start: 0, end: 0.4 },
      { word: "world", start: 0.6, end: 1 },
    ]);
  });

  // Whisper reads initial_prompt as text already spoken. Passing the script's own opening made it
  // skip the opening of the audio: on a 61 s narrated render, the first 40 words went missing and
  // the transcript check reported four phrases as dropped. A sorted word list steers spelling only.
  it("passes a glossary of the script's words as the prompt, never the script's opening", async () => {
    const dir = await mkdtemp(join(tmpdir(), "align-prompt-"));
    const textPath = join(dir, "t.txt"), out = join(dir, "w.json"), promptOut = join(dir, "prompt.txt");
    await writeFile(textPath, "This is a release checklist for a small web app. Watch it get filled in, one step at a time.");
    execFileSync("python3", [resolve("tools/align_whisper.py"), "unused.wav", textPath, out], {
      env: { ...process.env, PYTHONPATH: resolve("tests/fixtures/stub-whisper"), STUB_PROMPT_OUT: promptOut },
    });
    const prompt = await readFile(promptOut, "utf8");
    expect(prompt.startsWith("Glossary: ")).toBe(true);
    expect(prompt).not.toContain("This is a release");
    for (const w of ["checklist", "filled", "release", "Watch"]) expect(prompt).toContain(w);
    expect(prompt).not.toMatch(/\b(is|a|for|in|at|one)\b,/);
    expect(prompt.length).toBeLessThanOrEqual(220);
  });

  it("caps a long script's glossary at 220 characters on a whole word", async () => {
    const dir = await mkdtemp(join(tmpdir(), "align-prompt-long-"));
    const textPath = join(dir, "t.txt"), out = join(dir, "w.json"), promptOut = join(dir, "prompt.txt");
    const many = Array.from({ length: 80 }, (_, i) => `word${String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26))}`).join(" ");
    await writeFile(textPath, many);
    execFileSync("python3", [resolve("tools/align_whisper.py"), "unused.wav", textPath, out], {
      env: { ...process.env, PYTHONPATH: resolve("tests/fixtures/stub-whisper"), STUB_PROMPT_OUT: promptOut },
    });
    const prompt = await readFile(promptOut, "utf8");
    expect(prompt.length).toBeLessThanOrEqual(220);
    expect(prompt).toMatch(/^Glossary: (word[a-z]{2}, )*word[a-z]{2}$/);
  });
});
