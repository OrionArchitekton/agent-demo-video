import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../command-voice";
import { headlessBrowserEnv } from "../browser-env";

/**
 * Lines the HyperFrames CLI may print while still exiting 0 on a render that is wrong
 * (a missing font, a page script error, a blocked resource). The estate's proven render
 * treats any of them as a failed render. The one exception is the CLI's routine
 * "Continuing render despite lint issues" notice: lint warnings are non-blocking
 * and it prints that line on every render of a CSS-only card.
 */
const HARD_ERROR = /Unresolved font|PAGEERROR|net::ERR|Failed to load resource|Continuing render despite(?! lint issues)/;

/** The first CLI log line that reports a hard render error, or null. */
export function findRenderLogError(log: string): string | null {
  for (const line of log.split(/\r?\n/)) {
    if (HARD_ERROR.test(line)) return line.trim();
  }
  return null;
}

/** Render one motion card composition to an MP4 with the HyperFrames CLI (no shell, no desktop display). */
export async function renderMotionCard(hyperframesBin: string, html: string, outPath: string, label: string, timeoutSec = 300, onLog?: (text: string) => void): Promise<void> {
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
      { env: headlessBrowserEnv(), logPath },
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
