import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
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
interface LiveCommand {
  /** Grace between asking the group to stop (SIGTERM) and killing it; 0 kills at once. */
  gracefulKillMs: number;
  /** Set when interrupt cleanup stopped the command, so a clean exit is not a success. */
  interrupted: boolean;
}
const liveGroups = new Map<ChildProcess, LiveCommand>();
/** How long an exited command's stdio may keep draining before it is settled anyway. */
const STDIO_DRAIN_MS = 250;
const armedSignals = new Set<NodeJS.Signals>();
let exitHooked = false;

function signalGroup(owner: ChildProcess, signal: NodeJS.Signals): void {
  // IPC retains the specific owner's identity even if its numeric PID is reused.
  // A closed channel means the owner has gone; never fall back to PID signalling.
  if (!owner.connected) return;
  const report = (error: Error | null) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (error && code !== "ERR_IPC_CHANNEL_CLOSED" && code !== "EPIPE") {
      console.warn(`[agent-demo-video] command cleanup request could not send ${signal}: ${code ?? "unknown error"}`);
    }
  };
  try { owner.send({ type: "cleanup", signal }, report); }
  catch (error) { report(error as Error); }
}

/** The group owner stays alive until the command's bounded drain has finished.
 * Inline CommonJS keeps the supervisor available in both source and bundled CLIs.
 * Only this live owner signals its group; the caller uses the owned IPC channel.
 */
const COMMAND_SUPERVISOR = String.raw`
const { spawn } = require("node:child_process");
let reported = false;
let terminating = false;
function killGroup(signal) {
  try { process.kill(-process.pid, signal); }
  catch (error) {
    if (error.code !== "ESRCH" && process.connected) {
      process.send({ type: "cleanup-warning", code: error.code || "unknown error" }, () => process.exit(1));
    } else process.exit(1);
  }
}
function terminate() {
  if (terminating) return;
  terminating = true;
  killGroup("SIGTERM");
}
process.on("SIGTERM", terminate);
process.on("message", (message) => {
  if (!message || message.type !== "cleanup") return;
  if (message.signal === "SIGKILL") killGroup("SIGKILL");
  else if (message.signal === "SIGTERM") terminate();
});
process.on("disconnect", () => killGroup("SIGKILL"));
process.on("exit", () => { try { process.kill(-process.pid, "SIGKILL"); } catch {} });
function report(result) {
  if (reported) return;
  reported = true;
  if (!process.connected) return killGroup("SIGKILL");
  process.send({ type: "result", ...result }, (error) => {
    if (error) return killGroup("SIGKILL");
    if (terminating) killGroup("SIGKILL");
    else setTimeout(() => killGroup("SIGKILL"), ${STDIO_DRAIN_MS});
  });
}
const [program, ...args] = process.argv.slice(1);
const command = spawn(program, args, { stdio: ["ignore", "inherit", "inherit"] });
command.on("error", (error) => report({ error: { code: error.code, message: error.message } }));
command.on("exit", (code, signal) => report({ code, signal }));
`;

interface CommandResult {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: { code?: string; message: string };
}

/** Block this thread; used only by interrupt cleanup, which may run inside the exit hook. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Whether a command's leader process has exited. It is this process's child, and while
 * cleanup blocks the event loop it cannot be reaped, so it lingers as a zombie that still
 * accepts signals; on Linux /proc tells a zombie from a running process.
 */
function leaderExited(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.charAt(stat.lastIndexOf(")") + 2);
      return state === "Z" || state === "X";
    } catch { return true; }
  }
  try { process.kill(pid, 0); return false; } catch { return true; }
}

/**
 * Stop every live command. Commands started with gracefulKillMs are first asked to stop
 * (SIGTERM to the group) and given up to that long to exit, so a tool that runs helpers in
 * their own process groups can shut them down; then every group is SIGKILLed. Used by the
 * exit and signal hooks.
 */
export function killLiveCommands(): void {
  const graceful = [...liveGroups].filter(([, c]) => c.gracefulKillMs > 0);
  for (const c of liveGroups.values()) c.interrupted = true;
  for (const [owner] of graceful) signalGroup(owner, "SIGTERM");
  const deadline = Date.now() + Math.max(0, ...graceful.map(([, c]) => c.gracefulKillMs));
  while (graceful.some(([owner]) => owner.pid !== undefined && !leaderExited(owner.pid)) && Date.now() < deadline) sleepSync(25);
  for (const owner of liveGroups.keys()) signalGroup(owner, "SIGKILL");
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
  /**
   * On timeout or interrupt, send SIGTERM to the command's process group and wait up to
   * this long for it to exit before SIGKILL. For tools that start helpers (a browser, an
   * encoder) in their own process groups, which a group SIGKILL would orphan.
   */
  gracefulKillMs?: number;
}

/** Run an operator-supplied program WITHOUT a shell; every failure names `label` and its cause. */
export async function runCommand(label: string, template: string[], vars: Record<string, string>, timeoutSec: number, opts?: RunCommandOpts): Promise<void> {
  const [prog, ...args] = fillArgs(template, vars);
  if (!prog) throw new Error(`${label}: empty command`);
  const gracefulKillMs = Math.max(0, opts?.gracefulKillMs ?? 0);
  await new Promise<void>((resolveRun, reject) => {
    let settled = false;
    let timedOut = false;
    let drain: NodeJS.Timeout | undefined;
    let grace: NodeJS.Timeout | undefined;
    let commandResult: CommandResult | undefined;
    const live: LiveCommand = { gracefulKillMs, interrupted: false };
    const timedOutError = () => new Error(`${label}: timed out after ${timeoutSec}s`);
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      clearTimeout(grace);
      liveGroups.delete(child);
      // A helper the command left behind may still hold these pipes; let go of
      // them so it cannot keep this process alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      fn();
    };
    armCleanup();
    const child = spawn(process.execPath, ["--input-type=commonjs", "-e", COMMAND_SUPERVISOR, "--", prog, ...args], {
      detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"], env: opts?.env ?? process.env,
    });
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = message as CommandResult & { type?: string; code?: number | null };
      if (event.type === "result") {
        commandResult = event;
        // The command met its deadline. The live owner now performs its own
        // bounded drain; that cleanup must not turn completion into a timeout.
        clearTimeout(timer);
        clearTimeout(grace);
      }
      if (event.type === "cleanup-warning") {
        console.warn(`[agent-demo-video] command group cleanup could not send SIGKILL: ${String(event.code)}`);
      }
    });
    const tee = (d: Buffer | string) => {
      if (!opts?.logPath) return;
      try { appendFileSync(opts.logPath, d); } catch { /* the log is best-effort */ }
    };
    if (opts?.logPath) {
      try { writeFileSync(opts.logPath, ""); } catch { /* the log is best-effort */ }
    }
    if (child.pid !== undefined) liveGroups.set(child, live);
    let stderrTail = "";
    child.stdout!.on("data", tee);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => { stderrTail = (stderrTail + d).slice(-4000); tee(d); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (gracefulKillMs > 0) {
        // Ask first; the exit handler settles if the command stops within the grace.
        signalGroup(child, "SIGTERM");
        grace = setTimeout(() => {
          signalGroup(child, "SIGKILL");
          done(() => reject(timedOutError()));
        }, gracefulKillMs);
        grace.unref();
        return;
      }
      signalGroup(child, "SIGKILL");
      done(() => reject(timedOutError()));
    }, timeoutSec * 1000);
    timer.unref();
    child.on("error", (e: NodeJS.ErrnoException) => {
      done(() => reject(new Error(e.code === "ENOENT" ? `${label}: program not found: ${prog}` : `${label}: could not start ${prog}: ${e.message}`)));
    });
    // Settle on "exit", not "close": "close" waits for every holder of the
    // output pipes, so a command that exits but leaves a background helper
    // running would hang until the timeout. stderr stays best-effort: a short
    // grace (ended early by "close") lets an ordinary exit's last output drain.
    child.on("exit", (_ownerCode, ownerSignal) => {
      if (settled) return;
      // The live supervisor already drained and retired its group. Its PID may
      // now be recycled, so no cleanup signal is sent from this exit path.
      const finish = () => {
        if (settled) return;
        done(() => {
          if (timedOut) return reject(timedOutError());
          if (commandResult?.error) {
            const e = commandResult.error;
            return reject(new Error(e.code === "ENOENT" ? `${label}: program not found: ${prog}` : `${label}: could not start ${prog}: ${e.message}`));
          }
          if (!commandResult) return reject(new Error(ownerSignal
            ? `${label}: killed by signal ${ownerSignal}`
            : `${label}: command supervisor stopped before reporting a result`));
          const { code, signal } = commandResult;
          if (code === 0 && live.interrupted) return reject(new Error(`${label}: interrupted`));
          if (code === 0) return resolveRun();
          if (signal) return reject(new Error(`${label}: killed by signal ${signal}`));
          reject(new Error(`${label}: exited ${code}: ${stderrTail.trim().slice(-400)}`));
        });
      };
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
