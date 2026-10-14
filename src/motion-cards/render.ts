import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../command-voice";
import { headlessBrowserEnv } from "../browser-env";

/**
 * Lines the HyperFrames CLI may print while still exiting 0 on a render that is wrong
 * (a missing font, a page script error, a blocked resource). A proven render setup
 * treats any of them as a failed render. The one exception is the CLI's routine
 * "Continuing render despite lint issues" notice: lint warnings are non-blocking
 * and it prints that line on every render of a CSS-only card.
 */
const HARD_ERROR = /Unresolved font|PAGEERROR|net::ERR|Failed to load resource|Continuing render despite(?! lint issues)/;

/**
 * HyperFrames opt-outs, all read as "1" by the 0.8.155 CLI: no usage telemetry, no update
 * check, and no automatic self-install of a newer version (the pinned version is the one
 * that was tested). DO_NOT_TRACK is the cross-tool telemetry opt-out it also honors.
 */
export const HYPERFRAMES_OPT_OUT_ENV: Readonly<Record<string, string>> = {
  HYPERFRAMES_NO_TELEMETRY: "1",
  HYPERFRAMES_NO_UPDATE_CHECK: "1",
  HYPERFRAMES_NO_AUTO_INSTALL: "1",
  DO_NOT_TRACK: "1",
};

/** The first CLI log line that reports a hard render error, or null. */
export function findRenderLogError(log: string): string | null {
  for (const line of log.split(/\r?\n/)) {
    if (HARD_ERROR.test(line)) return line.trim();
  }
  return null;
}

/** Default limit for one card render: a first render may download a headless Chrome. */
export const MOTION_CARD_TIMEOUT_SEC = 900;
/**
 * HyperFrames starts Chrome and ffmpeg in their own process groups, which a SIGKILL to the
 * CLI's group would orphan. On timeout or interrupt it is asked to shut down (SIGTERM) and
 * given this long to stop them before it is killed.
 */
export const MOTION_CARD_GRACEFUL_KILL_MS = 5000;

/** Render one motion card composition to an MP4 with the HyperFrames CLI (no shell, no desktop display). */
export async function renderMotionCard(hyperframesBin: string, html: string, outPath: string, label: string, timeoutSec = MOTION_CARD_TIMEOUT_SEC, onLog?: (text: string) => void): Promise<void> {
  const project = await mkdtemp(join(tmpdir(), "motion-card-"));
  const logPath = join(project, "hyperframes.log");
  const name = `motion card (${label})`;
  try {
    await writeFile(join(project, "index.html"), html, "utf8");
    await runCommand(
      name,
      [process.execPath, hyperframesBin, "render", project, "-o", outPath, "--no-best-effort", "--no-browser-gpu", "-w", "2", "-q", "standard"],
      {},
      timeoutSec,
      { env: { ...headlessBrowserEnv(), ...HYPERFRAMES_OPT_OUT_ENV }, logPath, gracefulKillMs: MOTION_CARD_GRACEFUL_KILL_MS },
    );
    const log = await readFile(logPath, "utf8").catch(() => "");
    onLog?.(log);
    const bad = findRenderLogError(log);
    if (bad) throw new Error(`${name}: ${bad}`);
  } catch (e) {
    // A failed render must never leave an output a later step could mistake for a good card.
    await rm(outPath, { force: true }).catch(() => undefined);
    throw e;
  } finally {
    await rm(project, { recursive: true, force: true }).catch(() => undefined);
  }
}
