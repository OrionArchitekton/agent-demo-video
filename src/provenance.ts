import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DemoConfig, TimelineEntry } from "./types";
import type { TtsMode } from "./tts";

const exec = promisify(execFile);

export type ToolVersions = { ffmpeg: string; ffprobe: string; playwright: string; node: string };

export type RenderReport = {
  voice: DemoConfig["voice"];
  ttsMode: TtsMode;
  inputs: { configHash: string; scriptHash: string };
  tools: ToolVersions;
  timeline: { entries: TimelineEntry[]; totalSec: number };
  render: { totalSec: number; segments: number; ticks: number; parity: { ok: boolean; problems: string[] } };
  limits: { maxDurationSec: number };
};

/** Stable content digest for config/script inputs. Short, for eyeballing in a diff. */
export function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
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
  tools: ToolVersions;
  timeline: { entries: TimelineEntry[]; totalSec: number };
  render: { totalSec: number; segments: number; ticks: number; parity: { ok: boolean; problems: string[] } };
  maxDurationSec: number;
}): RenderReport {
  return {
    voice: o.voice,
    ttsMode: o.ttsMode,
    inputs: { configHash: o.configHash, scriptHash: o.scriptHash },
    tools: o.tools,
    timeline: o.timeline,
    render: o.render,
    limits: { maxDurationSec: o.maxDurationSec },
  };
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
 * Serialise the config for digesting, excluding values loadConfig resolves to
 * machine-local absolutes.
 *
 * `capture.auth.profileDir` becomes $XDG_CACHE_HOME/... and a "./" base becomes
 * a file:// URL of the checkout path, so hashing the post-load object gives the
 * SAME committed config different digests on two hosts. That would make a
 * local-vs-remote comparison report a configuration change that never happened,
 * which is the exact false attribution this report exists to end.
 */
export function stableConfigJson(config: DemoConfig): string {
  const { out: _out, ...rest } = config;
  const auth = rest.capture?.auth;
  return JSON.stringify({
    ...rest,
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
