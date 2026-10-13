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
