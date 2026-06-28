#!/usr/bin/env -S npx tsx
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config";
import { runPipeline } from "./pipeline";
import { captureLogin } from "./capture";

/**
 * Parse the CLI argv (after the node/script args) into a command.
 * - `login <cfg>`  → interactive auth-profile capture for live SaaS shots.
 * - `<cfg>` (bare) → run the pipeline (legacy / default; back-compat).
 */
export function parseCommand(argv: string[]): { cmd: "login" | "run"; cfgPath: string } {
  if (argv[0] === "login") return { cmd: "login", cfgPath: argv[1] ?? "demo.config.json" };
  return { cmd: "run", cfgPath: argv[0] ?? "demo.config.json" };
}

export async function main(argv: string[]): Promise<void> {
  const { cmd, cfgPath } = parseCommand(argv);
  const config = loadConfig(cfgPath);
  if (cmd === "login") {
    const dir = await captureLogin(config);
    console.log("✓ auth profile ready at", dir);
    return;
  }
  const r = await runPipeline(config);
  console.log("✓ wrote", r.outPath, "(" + r.report.totalSec.toFixed(1) + "s, " + r.report.segments + " segments)");
}

// Auto-run only when invoked as the entrypoint (so test imports don't run anything).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
