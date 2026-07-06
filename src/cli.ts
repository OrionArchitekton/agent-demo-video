#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { runPipeline } from "./pipeline";
import { captureLogin } from "./capture";
import { SshTransport } from "./transport";

/**
 * Parse the CLI argv (after the node/script args) into a command.
 * - `login <cfg>`               → interactive auth-profile capture for live SaaS shots.
 * - `<cfg> [--render-host H]`   → run the pipeline; --render-host offloads the render
 *                                 stage to host H over ssh (local render stays default).
 */
export function parseCommand(argv: string[]): { cmd: "login" | "run"; cfgPath: string; renderHost?: string } {
  let renderHost: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--render-host") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) throw new Error("--render-host requires a host argument");
      renderHost = argv[++i];
      continue;
    }
    if (a.startsWith("--render-host=")) {
      renderHost = a.slice("--render-host=".length);
      if (!renderHost || renderHost.startsWith("-"))
        throw new Error("--render-host requires a non-empty host argument that does not start with '-'");
      continue;
    }
    positional.push(a);
  }
  if (positional[0] === "login") return { cmd: "login", cfgPath: positional[1] ?? "demo.config.json", renderHost };
  return { cmd: "run", cfgPath: positional[0] ?? "demo.config.json", renderHost };
}

export async function main(argv: string[]): Promise<void> {
  const { cmd, cfgPath, renderHost } = parseCommand(argv);
  const config = loadConfig(cfgPath);
  if (cmd === "login") {
    const dir = await captureLogin(config);
    console.log("✓ auth profile ready at", dir);
    return;
  }
  const r = await runPipeline(config, renderHost ? { render: { transport: new SshTransport(renderHost) } } : {});
  if (renderHost) console.log("  (render offloaded to " + renderHost + ")");
  console.log("✓ wrote", r.outPath, "(" + r.report.totalSec.toFixed(1) + "s, " + r.report.segments + " segments)");
}

/** True when this module is the process entrypoint — symlink-robust so it still fires
 *  when invoked via the `node_modules/.bin/demo-video` symlink (where process.argv[1]
 *  is the symlink path but import.meta.url is the real file). */
function isEntrypoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

// Auto-run only when invoked as the entrypoint (so test imports don't run anything).
if (isEntrypoint()) {
  main(process.argv.slice(2)).catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
