import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { DemoConfig, TimelineEntry } from "./types";
import type { TtsMode } from "./tts";
import type { SourceBuildAttestation } from "./source-build";

const exec = promisify(execFile);

export type ToolVersions = { ffmpeg: string; ffprobe: string; playwright: string; node: string };

/**
 * Whether this artifact's selectors were verified before it was made.
 *
 * Without it, a render that DECLINED the gate is indistinguishable from one
 * that passed it: the flag survives only inside the opaque config digest, which
 * also moves for any unrelated edit and cannot be read back. `unverifiedShotIds`
 * names the shots the gate could not check at all (auth-walled live shots), so
 * "gated and clean" is distinguishable from "gated, but not where it counted".
 */
export type PreflightRecord = {
  ran: boolean;
  declined: boolean;
  findings: number;
  unverifiedShotIds: string[];
};

export type ClipInputDigest = {
  shotId: string;
  sha256: string;
};

export type RenderReport = {
  voice: DemoConfig["voice"];
  ttsMode: TtsMode;
  inputs: {
    configHash: string;
    scriptHash: string;
    configSha256: string;
    scriptSha256: string;
    clips: ClipInputDigest[];
  };
  /** Where the ffmpeg work actually happened. `tools` below is probed LOCALLY, so
   *  on "remote" it describes the machine that captured and synthesised, NOT the
   *  one that rendered. Recorded explicitly so a reader is never misled into
   *  attributing a runtime change to a toolchain that did not produce it. */
  renderedOn: "local" | "remote";
  tools: ToolVersions;
  timeline: { entries: TimelineEntry[]; totalSec: number };
  render: { totalSec: number; segments: number; ticks: number; parity: { ok: boolean; problems: string[] } };
  limits: { maxDurationSec: number };
  preflight: PreflightRecord;
  sourceBuildAttestation?: SourceBuildAttestation;
};

/** Short stable content digest retained for report compatibility and scanning. */
export function digest(content: string): string {
  return digestFull(content).slice(0, 16);
}

/** Full SHA-256 content digest for immutable render inputs. */
export function digestFull(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Stream a potentially large media input instead of loading it all into memory. */
export function digestFile(path: string): Promise<string> {
  return new Promise((resolveDigest, rejectDigest) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("error", rejectDigest);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolveDigest(hash.digest("hex")));
  });
}

/**
 * Assemble the provenance record for a finished render.
 *
 * Pure: every input is supplied. The point is that comparing two reports
 * explains a runtime change (a swapped voice model, a different ffmpeg, an
 * edited script) instead of leaving it attributed to vendor nondeterminism.
 */
export function buildRenderReport(o: {
  voice: DemoConfig["voice"];
  ttsMode: TtsMode;
  configHash: string;
  scriptHash: string;
  configSha256: string;
  scriptSha256: string;
  clips: ClipInputDigest[];
  tools: ToolVersions;
  timeline: { entries: TimelineEntry[]; totalSec: number };
  render: { totalSec: number; segments: number; ticks: number; parity: { ok: boolean; problems: string[] } };
  maxDurationSec: number;
  renderedOn: "local" | "remote";
  preflight: PreflightRecord;
  sourceBuildAttestation?: SourceBuildAttestation;
}): RenderReport {
  return {
    voice: o.voice,
    ttsMode: o.ttsMode,
    inputs: {
      configHash: o.configHash,
      scriptHash: o.scriptHash,
      configSha256: o.configSha256,
      scriptSha256: o.scriptSha256,
      clips: o.clips,
    },
    renderedOn: o.renderedOn,
    tools: o.tools,
    timeline: o.timeline,
    render: o.render,
    limits: { maxDurationSec: o.maxDurationSec },
    preflight: o.preflight,
    ...(o.sourceBuildAttestation ? { sourceBuildAttestation: o.sourceBuildAttestation } : {}),
  };
}

/**
 * Preserve the historical best-effort report for ordinary renders while
 * making source-attested production evidence mandatory.
 */
export async function persistRenderReport(
  path: string,
  report: RenderReport,
  required: boolean,
): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(report, null, 2));
  } catch (error) {
    const detail = (error as Error).message;
    if (required) {
      throw new Error(
        `[agent-demo-video] required render-report.json could not be written: ${detail}`,
        { cause: error },
      );
    }
    console.warn(
      `[agent-demo-video] could not write render-report.json: ${detail}`,
    );
  }
}

async function firstLine(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { timeout: 5000 });
    return (stdout.split("\n")[0] ?? "").trim() || "unknown";
  } catch {
    // Provenance is a record, never a gate: an unavailable tool is recorded as
    // unknown rather than failing a render that has already been paid for.
    return "unknown";
  }
}

/** Probe the toolchain actually on PATH. Never throws. */
export async function toolVersions(): Promise<ToolVersions> {
  const [ffmpeg, ffprobe] = await Promise.all([
    firstLine("ffmpeg", ["-version"]),
    firstLine("ffprobe", ["-version"]),
  ]);
  let playwright = "unknown";
  try {
    const req = (await import("node:module")).createRequire(import.meta.url);
    playwright = req("playwright/package.json").version ?? "unknown";
  } catch {
    playwright = "unknown";
  }
  return { ffmpeg, ffprobe, playwright, node: process.version };
}

/**
 * Serialise the config for digesting, excluding machine-local output locations
 * and canonicalising values loadConfig resolves to machine-local absolutes.
 *
 * `capture.auth.profileDir` becomes $XDG_CACHE_HOME/... and a "./" base becomes
 * a file:// URL of the checkout path, so hashing the post-load object gives the
 * SAME committed config different digests on two hosts. That would make a
 * local-vs-remote comparison report a configuration change that never happened,
 * which is the exact false attribution this report exists to end.
 */
export function stableConfigJson(config: DemoConfig): string {
  // configDir is the absolute directory of the config FILE, set by loadConfig.
  // Production overrides make script and clipsDir absolute inside a unique
  // run-id root. Preserve their relationship to the config (which distinguishes
  // genuinely different sources) without hashing that run-id prefix. Programmatic
  // configs with no configDir retain their original values.
  const { out: _out, configDir, ...rest } = config;
  const inputLocation = (location: string): string => {
    if (!configDir || !isAbsolute(location)) return location;
    const fromConfig = relative(configDir, location);
    return fromConfig.split(sep).join("/") || ".";
  };
  const auth = rest.capture?.auth;
  return JSON.stringify({
    ...rest,
    script: inputLocation(rest.script),
    clipsDir: inputLocation(rest.clipsDir),
    // A relative base ("./") is resolved to a file:// URL of THIS checkout, so
    // hashing it verbatim re-introduces the machine dependence this function
    // exists to remove. A local fixture base is not part of a config's identity;
    // an http(s) base is, and is machine-independent, so it is kept verbatim.
    dashboardBaseUrl: rest.dashboardBaseUrl.startsWith("file://")
      ? "file://<local>"
      : rest.dashboardBaseUrl,
    capture: auth ? { ...rest.capture, auth: { ...auth, profileDir: undefined } } : rest.capture,
  });
}
