import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fillArgs, runCommand, readWordsFile, killLiveCommands } from "./command-voice";

const fx = (n: string) => resolve("tests/fixtures/voice", n);

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitGone(pid: number): Promise<void> {
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
}
async function readPid(path: string): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const raw = await readFile(path, "utf8").catch(() => "");
    if (raw.trim()) return Number(raw.trim());
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no pid written to ${path}`);
}

describe("fillArgs", () => {
  it("substitutes known placeholders and leaves unknown ones", () => {
    expect(fillArgs(["tts", "--in={text}", "{out}", "{nope}"], { text: "/t", out: "/o" })).toEqual(["tts", "--in=/t", "/o", "{nope}"]);
  });
  it("does not substitute prototype keys", () => {
    expect(fillArgs(["{constructor}", "{toString}"], { out: "/o" })).toEqual(["{constructor}", "{toString}"]);
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

describe("runCommand edge cases", () => {
  it("kills the whole process tree on timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gc-"));
    const pidFile = join(dir, "pid");
    await expect(runCommand("v", [fx("grandchild.sh"), pidFile], {}, 1)).rejects.toThrowError(/timed out after 1s/);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    for (let i = 0; i < 10; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it("names a signal kill", async () => {
    await expect(runCommand("v", [fx("selfkill.sh")], {}, 5)).rejects.toThrowError(/killed by signal SIGKILL/);
  });
  it("interrupt cleanup kills a running command's whole process tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gc-"));
    const pidFile = join(dir, "pid");
    const run = runCommand("v", [fx("grandchild.sh"), pidFile], {}, 30);
    const pid = await readPid(pidFile);
    expect(alive(pid)).toBe(true);
    killLiveCommands();
    await expect(run).rejects.toThrowError(/killed by signal SIGKILL/);
    await waitGone(pid);
    expect(alive(pid)).toBe(false);
  });
  it("settles when the command exits, even if a background helper keeps its output open", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bg-"));
    const pidFile = join(dir, "pid");
    const t0 = Date.now();
    try {
      await expect(runCommand("v", [fx("bg-helper.sh"), pidFile], {}, 3)).resolves.toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      const helper = await readPid(pidFile).catch(() => 0);
      if (helper) try { process.kill(helper, "SIGKILL"); } catch { /* gone */ }
    }
  });
  it("rejects an empty command", async () => {
    await expect(runCommand("v", [], {}, 5)).rejects.toThrowError(/v: empty command/);
  });
});

describe("readWordsFile", () => {
  it("rejects a path that is not a regular file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "words-"));
    await expect(readWordsFile(dir, "x")).rejects.toThrowError(new RegExp(`^x: word timings path ${dir} is not a regular file`));
  });
  it("returns null when the file is absent", async () => {
    expect(await readWordsFile("/no/such/words.json", "x")).toBeNull();
  });
  it("rejects more than 20000 word timings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "words-"));
    const p = join(dir, "w.json");
    await writeFile(p, JSON.stringify(Array.from({ length: 20001 }, (_, i) => ({ word: "a", start: i, end: i + 1 }))));
    await expect(readWordsFile(p, "aligner (shot s1)")).rejects.toThrowError(/^aligner \(shot s1\): too many word timings \(20001, max 20000\)/);
  });
  it("accepts exactly 20000 word timings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "words-"));
    const p = join(dir, "w.json");
    await writeFile(p, JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ word: "a", start: i, end: i + 1 }))));
    expect(await readWordsFile(p, "x")).toHaveLength(20000);
  });
  it("rejects malformed timings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "words-"));
    const p = join(dir, "w.json");
    await writeFile(p, JSON.stringify([{ word: "a", start: 1, end: 0.5 }]));
    await expect(readWordsFile(p, "voice command (shot s1)")).rejects.toThrowError(/voice command \(shot s1\): malformed word timings/);
  });
});
