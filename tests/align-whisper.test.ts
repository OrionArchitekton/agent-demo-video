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
  const promptFor = async (script: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "align-prompt-"));
    const textPath = join(dir, "t.txt"), out = join(dir, "w.json"), promptOut = join(dir, "prompt.txt");
    await writeFile(textPath, script);
    execFileSync("python3", [resolve("tools/align_whisper.py"), "unused.wav", textPath, out], {
      env: { ...process.env, PYTHONPATH: resolve("tests/fixtures/stub-whisper"), STUB_PROMPT_OUT: promptOut },
    });
    return readFile(promptOut, "utf8");
  };

  it("passes the full glossary of the script's words, never the script's opening", async () => {
    const prompt = await promptFor("This is a release checklist for a small web app. Watch it get filled in, one step at a time.");
    expect(prompt).toBe("Glossary: checklist, filled, release, small, step, This, time, Watch");
  });

  it("keeps whole non-ASCII words and skips overlong runs", async () => {
    const cjkRun = "这是一个非常长的没有空格的中文句子用于测试的第二部分内容";
    const prompt = await promptFor(`Una demostración rápida. Привет мир, это демонстрация. ${cjkRun}`);
    expect(prompt).toContain("demostración");
    expect(prompt).toContain("rápida");
    expect(prompt).toContain("Привет");
    expect(prompt).toContain("демонстрация");
    expect(cjkRun.length).toBeGreaterThan(24);
    expect(prompt).not.toContain(cjkRun);
  });

  it("never opens with the script's own first words in order", async () => {
    // Sorted alphabetically, these words would come out in exactly their spoken order.
    const prompt = await promptFor("Apples bring cheer daily, every evening.");
    expect(prompt.startsWith("Glossary: Apples, bring, cheer")).toBe(false);
    for (const w of ["Apples", "bring", "cheer", "daily", "every", "evening"]) expect(prompt).toContain(w);
  });

  it("caps at 220 characters, skipping a word that does not fit rather than stopping", async () => {
    // 33 four-letter "a..." words fill the prompt to 206 characters; the 20-letter "b..." word no
    // longer fits, but the four-letter "cccc" after it still does.
    const fill = Array.from({ length: 33 }, (_, i) => `a${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}x`);
    const long = "b".repeat(20);
    // (Spoken order differs from sorted order, so the reversal guard stays out of this test.)
    const prompt = await promptFor(`${long} cccc ${fill.join(" ")}`);
    expect(prompt.length).toBeLessThanOrEqual(220);
    for (const w of fill) expect(prompt).toContain(w);
    expect(prompt).not.toContain(long);
    expect(prompt.endsWith(", cccc")).toBe(true);
  });
});
