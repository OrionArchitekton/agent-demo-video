import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { TimedWord } from "./word-timing";

/** Substitute {name} placeholders in an argv template; unknown placeholders are left as is. */
export function fillArgs(template: string[], vars: Record<string, string>): string[] {
  return template.map((a) => a.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k]! : m)));
}

/**
 * Process groups of voice and aligner commands still running. Each command is
 * spawned detached (its own group, so a timeout can kill the whole tree), which
 * also means a terminal Ctrl-C never reaches it: without this registry an
 * interrupted render would leave the voice model running.
 */
const liveGroups = new Set<number>();
/** How long an exited command's stdio may keep draining before it is settled anyway. */
const STDIO_DRAIN_MS = 250;
const armedSignals = new Set<NodeJS.Signals>();
let exitHooked = false;

/** SIGKILL every live command's process group. Used by the exit and signal hooks. */
export function killLiveCommands(): void {
  for (const pid of liveGroups) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

function onTerminatingSignal(signal: NodeJS.Signals): void {
  killLiveCommands();
  const others = process.listeners(signal).some((l) => l !== onTerminatingSignal);
  process.removeListener(signal, onTerminatingSignal);
  armedSignals.delete(signal);
  // Node suppresses its default exit while any listener exists. When ours was
  // the last one, re-deliver so the CLI still exits with ordinary signal
  // semantics; otherwise the remaining listener already received this signal.
  if (!others) process.kill(process.pid, signal);
}

function armCleanup(): void {
  if (!exitHooked) { exitHooked = true; process.on("exit", killLiveCommands); }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    if (!armedSignals.has(signal)) { armedSignals.add(signal); process.on(signal, onTerminatingSignal); }
  }
}

export interface RunCommandOpts {
  /** Child environment; defaults to the parent's. */
  env?: Record<string, string>;
  /** Tee the child's combined stdout and stderr to this file (created or truncated at start). */
  logPath?: string;
}

/** Run an operator-supplied program WITHOUT a shell; every failure names `label` and its cause. */
export async function runCommand(label: string, template: string[], vars: Record<string, string>, timeoutSec: number, opts?: RunCommandOpts): Promise<void> {
  const [prog, ...args] = fillArgs(template, vars);
  if (!prog) throw new Error(`${label}: empty command`);
  await new Promise<void>((resolveRun, reject) => {
    let settled = false;
    let drain: NodeJS.Timeout | undefined;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      // A helper the command left behind may still hold these pipes; let go of
      // them so it cannot keep this process alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      fn();
    };
    armCleanup();
    const child = spawn(prog, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: opts?.env ?? process.env });
    const tee = (d: Buffer | string) => {
      if (!opts?.logPath) return;
      try { appendFileSync(opts.logPath, d); } catch { /* the log is best-effort */ }
    };
    if (opts?.logPath) {
      try { writeFileSync(opts.logPath, ""); } catch { /* the log is best-effort */ }
    }
    if (child.pid !== undefined) liveGroups.add(child.pid);
    let stderrTail = "";
    child.stdout!.on("data", tee);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => { stderrTail = (stderrTail + d).slice(-4000); tee(d); });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
      done(() => reject(new Error(`${label}: timed out after ${timeoutSec}s`)));
    }, timeoutSec * 1000);
    timer.unref();
    child.on("error", (e: NodeJS.ErrnoException) => {
      done(() => reject(new Error(e.code === "ENOENT" ? `${label}: program not found: ${prog}` : `${label}: could not start ${prog}: ${e.message}`)));
    });
    // Settle on "exit", not "close": "close" waits for every holder of the
    // output pipes, so a command that exits but leaves a background helper
    // running would hang until the timeout. stderr stays best-effort: a short
    // grace (ended early by "close") lets an ordinary exit's last output drain.
    child.on("exit", (code, signal) => {
      const finish = () => done(() => {
        if (code === 0) return resolveRun();
        if (signal) return reject(new Error(`${label}: killed by signal ${signal}`));
        reject(new Error(`${label}: exited ${code}: ${stderrTail.trim().slice(-400)}`));
      });
      child.once("close", finish);
      drain = setTimeout(finish, STDIO_DRAIN_MS);
      drain.unref();
    });
  });
}

/** Read [{word,start,end}] timings; null when the file is absent, an error when it is malformed. */
/** Most word timings one shot may carry; a longer list is a runaway or hostile command. */
export const MAX_WORD_TIMINGS = 20000;

export async function readWordsFile(path: string, label: string): Promise<TimedWord[] | null> {
  let raw: string;
  try {
    const st = await stat(path);
    if (!st.isFile()) throw new Error(`${label}: word timings path ${path} is not a regular file`);
    if (st.size > 5 * 1024 * 1024) throw new Error(`${label}: word timings file ${path} is too large`);
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    if ((e as Error).message.startsWith(`${label}: word timings `)) throw e;
    throw new Error(`${label}: cannot read word timings at ${path}: ${(e as Error).message}`);
  }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error(`${label}: malformed word timings in ${path} (not JSON)`); }
  if (Array.isArray(data) && data.length > MAX_WORD_TIMINGS) {
    throw new Error(`${label}: too many word timings (${data.length}, max ${MAX_WORD_TIMINGS})`);
  }
  const ok = Array.isArray(data) && data.every((w) =>
    w && typeof w.word === "string" && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end >= w.start);
  if (!ok) throw new Error(`${label}: malformed word timings in ${path} (need [{word, start, end}] with 0 <= start <= end)`);
  return data as TimedWord[];
}
