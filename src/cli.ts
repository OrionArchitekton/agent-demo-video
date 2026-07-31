#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Parse the CLI argv (after the node/script args) into a command.
 * - `login <cfg>`               → interactive auth-profile capture for live SaaS shots.
 * - `<cfg> [--render-host H]`   → run the pipeline; --render-host offloads the render
 *                                 stage to host H over ssh (local render stays default).
 * - `--no-preflight`            → decline the fail-closed selector gate for this run
 *                                 (the config key `preflight` is the durable declaration).
 * - `--out <new-dir>`           → override config.out, atomically reserve a
 *                                 fresh name, and bind writes to private staging.
 * - `--clips-dir <dir>`         → override clipsDir for this run so production
 *                                 can render attempt-owned evidence copies.
 * - `--script <file>`           → override the narration manifest for this run
 *                                 so production can render an owned script copy.
 * - `--attest-source-build`     → reserved for the committed detached-snapshot
 *                                 launcher; bind and recheck that frozen source.
 */
export function parseCommand(argv: string[]): {
  cmd: "login" | "run";
  cfgPath: string;
  renderHost?: string;
  preflight?: boolean;
  out?: string;
  clipsDir?: string;
  script?: string;
  attestSourceBuild?: boolean;
} {
  let renderHost: string | undefined;
  let preflight: boolean | undefined;
  let out: string | undefined;
  let clipsDir: string | undefined;
  let script: string | undefined;
  let attestSource = false;
  const positional: string[] = [];
  const seenFlags = new Set<string>();
  const requireOnce = (flag: string) => {
    if (seenFlags.has(flag)) {
      throw new Error(`${flag} may be supplied once`);
    }
    seenFlags.add(flag);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // Consumed as a flag, never pushed to positional: otherwise a leading
    // --no-preflight would be read as the config path.
    if (a === "--no-preflight") {
      requireOnce("--no-preflight");
      preflight = false;
      continue;
    }
    if (a === "--attest-source-build") {
      requireOnce("--attest-source-build");
      attestSource = true;
      continue;
    }
    if (a === "--render-host") {
      requireOnce("--render-host");
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) throw new Error("--render-host requires a host argument");
      renderHost = argv[++i];
      continue;
    }
    if (a.startsWith("--render-host=")) {
      requireOnce("--render-host");
      renderHost = a.slice("--render-host=".length);
      if (!renderHost || renderHost.startsWith("-"))
        throw new Error("--render-host requires a non-empty host argument that does not start with '-'");
      continue;
    }
    if (a === "--out") {
      requireOnce("--out");
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) throw new Error("--out requires a new directory argument");
      out = argv[++i];
      continue;
    }
    if (a.startsWith("--out=")) {
      requireOnce("--out");
      out = a.slice("--out=".length);
      if (!out || out.startsWith("-"))
        throw new Error("--out requires a non-empty directory argument that does not start with '-'");
      continue;
    }
    if (a === "--clips-dir") {
      requireOnce("--clips-dir");
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) throw new Error("--clips-dir requires a directory argument");
      clipsDir = argv[++i];
      continue;
    }
    if (a.startsWith("--clips-dir=")) {
      requireOnce("--clips-dir");
      clipsDir = a.slice("--clips-dir=".length);
      if (!clipsDir || clipsDir.startsWith("-"))
        throw new Error("--clips-dir requires a non-empty directory argument that does not start with '-'");
      continue;
    }
    if (a === "--script") {
      requireOnce("--script");
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) throw new Error("--script requires a file argument");
      script = argv[++i];
      continue;
    }
    if (a.startsWith("--script=")) {
      requireOnce("--script");
      script = a.slice("--script=".length);
      if (!script || script.startsWith("-"))
        throw new Error("--script requires a non-empty file argument that does not start with '-'");
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`unknown option: ${a}`);
    }
    positional.push(a);
  }
  if (positional[0] === "login") {
    if (positional.length > 2) {
      throw new Error("login accepts at most one config path");
    }
    if (attestSource)
      throw new Error("--attest-source-build is only valid for a pipeline run, not login");
    if (renderHost)
      throw new Error("--render-host is only valid for a pipeline run, not login");
    if (preflight === false)
      throw new Error("--no-preflight is only valid for a pipeline run, not login");
    if (out || clipsDir || script)
      throw new Error("--out, --clips-dir, and --script are only valid for a pipeline run, not login");
    return {
      cmd: "login",
      cfgPath: positional[1] ?? "demo.config.json",
    };
  }
  if (positional.length > 1) {
    throw new Error("pipeline run accepts exactly one config path");
  }
  if (attestSource && renderHost)
    throw new Error("--attest-source-build cannot be combined with --render-host");
  return {
    cmd: "run",
    cfgPath: positional[0] ?? "demo.config.json",
    renderHost,
    ...(preflight === false ? { preflight } : {}),
    ...(out ? { out } : {}),
    ...(clipsDir ? { clipsDir } : {}),
    ...(script ? { script } : {}),
    ...(attestSource ? { attestSourceBuild: true } : {}),
  };
}

export async function main(argv: string[]): Promise<void> {
  const {
    cmd,
    cfgPath,
    renderHost,
    preflight,
    out,
    clipsDir,
    script,
    attestSourceBuild: shouldAttestSourceBuild,
  } = parseCommand(argv);
  // A mutable checkout module could execute and restore its own file before
  // an in-process admission check. Refuse the attested mode before importing
  // any application module unless the committed launcher established a
  // detached snapshot boundary.
  if (
    shouldAttestSourceBuild &&
    (
      !process.env.AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_ROOT ||
      !process.env.AGENT_DEMO_VIDEO_SOURCE_AUTHORITY_REPO ||
      !process.env.AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_COMMIT
    )
  ) {
    throw new Error(
      "--attest-source-build requires the committed source snapshot launcher",
    );
  }
  const sourceBuild = shouldAttestSourceBuild
    ? await (await import("./source-build")).attestSourceBuild(
        fileURLToPath(import.meta.url),
      )
    : undefined;
  const { loadConfig } = await import("./config");
  const config = loadConfig(cfgPath);
  // A per-run decline lands ON the config, so the render receipt's config hash
  // records that this artifact shipped without the gate.
  if (preflight === false) config.preflight = false;
  if (out) config.out = out;
  if (clipsDir) config.clipsDir = clipsDir;
  if (script) config.script = script;
  if (cmd === "login") {
    const { captureLogin } = await import("./capture");
    const dir = await captureLogin(config);
    console.log("✓ auth profile ready at", dir);
    return;
  }
  // Source admission above runs before importing the pipeline, before a fresh
  // output name can be claimed, and before any render artifact can be mutated.
  const { runPipeline } = await import("./pipeline");
  const render = renderHost
    ? { transport: new (await import("./transport")).SshTransport(renderHost) }
    : undefined;
  const r = await runPipeline(config, {
    ...(render ? { render } : {}),
    ...(out ? { requireFreshOut: true } : {}),
    ...(sourceBuild ? { sourceBuild } : {}),
  });
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
