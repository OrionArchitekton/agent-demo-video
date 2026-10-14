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
  it("passes opts.env to the child instead of the parent environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "env-"));
    const out = join(dir, "out.txt");
    const prev = process.env.DISPLAY;
    process.env.DISPLAY = ":99";
    try {
      await runCommand("env probe", [fx("print-env.sh"), "{out}"], { out }, 5, { env: { PATH: process.env.PATH! } });
    } finally {
      if (prev === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = prev;
    }
    expect(await readFile(out, "utf8")).toBe("unset");
  });
  it("tees stdout and stderr to opts.logPath", async () => {
    const dir = await mkdtemp(join(tmpdir(), "log-"));
    const logPath = join(dir, "cli.log");
    await runCommand("log probe", [fx("pageerror-exit0.sh")], {}, 5, { logPath });
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("rendering...");
    expect(log).toContain("PAGEERROR boom");
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
  it("with gracefulKillMs, a timeout asks the command to stop (SIGTERM) before killing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "term-"));
    const marker = join(dir, "marker");
    await expect(runCommand("v", [fx("term-trap.sh"), marker], {}, 1, { gracefulKillMs: 2000 })).rejects.toThrowError(/^v: timed out after 1s$/);
    expect(await readFile(marker, "utf8")).toBe("term");
  });
  it("with gracefulKillMs, a timeout still kills a command that ignores SIGTERM once the grace has passed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "term-"));
    const pidFile = join(dir, "pid");
    const t0 = Date.now();
    await expect(runCommand("v", [fx("term-ignore.sh"), pidFile], {}, 1, { gracefulKillMs: 500 })).rejects.toThrowError(/^v: timed out after 1s$/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    const pid = await readPid(pidFile);
    await waitGone(pid);
    expect(alive(pid)).toBe(false);
  });
  it("interrupt cleanup asks a gracefulKillMs command to stop before killing it, and the run does not count as a success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "term-"));
    const marker = join(dir, "marker");
    const pidFile = join(dir, "pid");
    const run = runCommand("v", [fx("term-trap.sh"), marker, pidFile], {}, 30, { gracefulKillMs: 2000 });
    const outcome = run.then(() => "resolved", (e: Error) => e.message);
    await readPid(pidFile);
    killLiveCommands();
    expect(await readFile(marker, "utf8")).toBe("term");
    expect(await outcome).toBe("v: interrupted");
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
  it("leaves no timers or pipes of its own referenced once the command has exited, even if a helper holds the pipes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bg-"));
    const pidFile = join(dir, "pid");
    const count = (kind: string) => process.getActiveResourcesInfo().filter((r) => r === kind).length;
    const before = { timeout: count("Timeout"), pipe: count("PipeWrap") };
    try {
      await runCommand("v", [fx("bg-helper.sh"), pidFile], {}, 30);
      for (let i = 0; i < 20 && count("PipeWrap") > before.pipe; i++) await new Promise((r) => setTimeout(r, 10));
      expect(count("Timeout")).toBeLessThanOrEqual(before.timeout);
      expect(count("PipeWrap")).toBeLessThanOrEqual(before.pipe);
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
