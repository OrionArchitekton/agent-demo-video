import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { runCommand } from "./command-voice";
import { optionalToolEnv } from "./optional-intro";
import type { DemoConfig } from "./types";

type State = "pass" | "fail" | "unavailable";
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

/** Read-only diagnostics on the delivered MP4. Every failure stays advisory. */
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
  const parent = join(out, "look-check");
  let root: string;
  try {
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, "attempt-"));
  }
  catch { return { ...result, windows: windows.map((w) => ({ ...w, state: "unavailable", reason: "diagnostics_unavailable" })) }; }
  for (const w of windows) {
    const log = join(root, `${w.name}.log`);
    const current: LookWindow = { ...w, state: "unavailable" };
    let commandFailed = false;
    let unavailable = false;
    try {
      await runCommand("advisory look checker", choice.command, { video, start: String(w.startSec),
        duration: String(w.durationSec), profile: "motion" }, choice.timeoutSec,
      { gracefulKillMs: 5000, env: optionalToolEnv(), logPath: log });
    } catch (error) {
      commandFailed = true;
      unavailable = /program not found|could not start|timed out/.test((error as Error).message);
    }
    try {
      const lines = (await readFile(log, "utf8")).trim().split("\n").reverse();
      let parsed: z.infer<typeof resultSchema> | undefined;
      for (const line of lines) {
        try { parsed = resultSchema.parse(JSON.parse(line)); break; } catch { /* stderr/non-JSON */ }
      }
      if (!parsed || unavailable || parsed.metrics.secs_measured + 0.1 + 1 / config.fps < w.durationSec) {
        current.reason = unavailable ? "checker_unavailable" : "incomplete_or_invalid_metrics";
      } else {
        current.metrics = parsed.metrics;
        current.state = !commandFailed && parsed.passed && parsed.metrics.motion_pct >= 30 &&
          parsed.metrics.contrast >= 100 && parsed.metrics.luma_mean >= 50 ? "pass" : "fail";
      }
    } catch { current.reason = "checker_unavailable"; }
    result.windows.push(current);
  }
  result.state = result.windows.some((w) => w.state === "fail") ? "fail" :
    result.windows.every((w) => w.state === "pass") ? "pass" : "unavailable";
  return result;
}
