import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, open } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { runCommand } from "./command-voice";
import { optionalToolEnv } from "./optional-intro";
import type { DemoConfig } from "./types";
import { digestFile } from "./provenance";

type State = "pass" | "fail" | "unavailable";
const MAX_CHECKER_OUTPUT_BYTES = 1024 * 1024;

async function checkerOutput(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error("checker log is not a regular file");
    const buffer = Buffer.alloc(MAX_CHECKER_OUTPUT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_CHECKER_OUTPUT_BYTES) throw new Error("checker output limit exceeded");
    return buffer.subarray(0, length).toString("utf8");
  } finally { await file.close(); }
}
export interface LookWindow {
  name: "complete" | "intro" | "body";
  startSec: number;
  durationSec: number;
  state: State;
  reason?: string;
  metrics?: { motion_pct: number; contrast: number; luma_mean: number; secs_measured: number };
}
export interface LookResult {
  profile: "motion";
  state: State;
  checker?: string;
  windows: LookWindow[];
}
const resultSchema = z.object({
  profile: z.literal("motion"), passed: z.boolean(),
  metrics: z.object({ motion_pct: z.number().finite().min(0).max(100),
    contrast: z.number().finite().min(0).max(255), luma_mean: z.number().finite().min(0).max(255),
    secs_measured: z.number().finite().positive() }),
});

/** Measurement failures stay advisory; a changed deliverable remains fatal. */
export async function runLookCheck(video: string, config: DemoConfig, totalSec: number,
  introSec: number | undefined, out: string): Promise<LookResult> {
  const result: LookResult = { profile: "motion", state: "unavailable", windows: [] };
  const windows: Array<Pick<LookWindow, "name" | "startSec" | "durationSec">> = [
    { name: "complete", startSec: 0, durationSec: totalSec },
  ];
  if (introSec) {
    windows.push({ name: "intro", startSec: 0, durationSec: introSec });
    if (totalSec > introSec) windows.push({ name: "body", startSec: introSec, durationSec: totalSec - introSec });
  }
  const choice = config.lookCheck;
  if (!choice) {
    result.windows = windows.map((w) => ({ ...w, state: "unavailable", reason: "checker_unavailable" }));
    return result;
  }
  result.checker = basename(choice.command[0]!);
  const deliveredHash = await digestFile(video);
  const assertDeliveredUnchanged = async () => {
    try {
      if (!(await lstat(video)).isFile() || await digestFile(video) !== deliveredHash) throw new Error("changed bytes");
    } catch (cause) { throw new Error("delivered video changed during look check", { cause }); }
  };
  const parent = join(out, "look-check");
  let root: string;
  let snapshot: string;
  try {
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, "attempt-"));
    snapshot = join(root, "input.mp4");
    await copyFile(video, snapshot);
    await chmod(snapshot, 0o400);
    if (await digestFile(snapshot) !== deliveredHash) throw new Error("snapshot changed");
  }
  catch {
    await assertDeliveredUnchanged();
    return { ...result, windows: windows.map((w) => ({ ...w, state: "unavailable", reason: "diagnostics_unavailable" })) };
  }
  let snapshotUsable = true;
  for (const w of windows) {
    const log = join(root, `${w.name}.log`);
    const current: LookWindow = { ...w, state: "unavailable" };
    if (!snapshotUsable) {
      result.windows.push({ ...current, reason: "checker_modified_input" });
      continue;
    }
    let commandFailed = false;
    let unavailable = false;
    let outputLimited = false;
    try {
      await runCommand("advisory look checker", choice.command, { video: snapshot, start: String(w.startSec),
        duration: String(w.durationSec), profile: "motion" }, choice.timeoutSec,
      { gracefulKillMs: 5000, env: optionalToolEnv(), logPath: log, maxOutputBytes: MAX_CHECKER_OUTPUT_BYTES });
    } catch (error) {
      commandFailed = true;
      outputLimited = (error as Error).message.includes("output limit exceeded");
      unavailable = /program not found|could not start|timed out/.test((error as Error).message);
    }
    await assertDeliveredUnchanged();
    snapshotUsable = await digestFile(snapshot).then((hash) => hash === deliveredHash).catch(() => false);
    if (!snapshotUsable) {
      result.windows.push({ ...current, reason: "checker_modified_input" });
      continue;
    }
    if (outputLimited) {
      result.windows.push({ ...current, reason: "checker_output_limit" });
      continue;
    }
    try {
      const lines = (await checkerOutput(log)).trim().split("\n").reverse();
      let parsed: z.infer<typeof resultSchema> | undefined;
      for (const line of lines) {
        try { parsed = resultSchema.parse(JSON.parse(line)); break; } catch { /* stderr/non-JSON */ }
      }
      if (!parsed || w.durationSec <= 0 ||
          Math.abs(parsed.metrics.secs_measured - w.durationSec) > 0.1 + 1 / config.fps) {
        current.reason = unavailable ? "checker_unavailable" : "incomplete_or_invalid_metrics";
      } else {
        current.metrics = parsed.metrics;
        current.state = !commandFailed && parsed.passed && parsed.metrics.motion_pct >= 30 &&
          parsed.metrics.contrast >= 100 && parsed.metrics.luma_mean >= 50 ? "pass" : "fail";
      }
    } catch (error) { current.reason = (error as Error).message.includes("output limit exceeded") ? "checker_output_limit" : "checker_unavailable"; }
    result.windows.push(current);
  }
  result.state = result.windows.some((w) => w.state === "fail") ? "fail" :
    result.windows.every((w) => w.state === "pass") ? "pass" : "unavailable";
  await assertDeliveredUnchanged();
  return result;
}
