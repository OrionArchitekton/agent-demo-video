import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveClipPath } from "../src/clips.js";
import { loadConfig } from "../src/config.js";
import { probeDurationSec, probeSizePx } from "../src/ffmpeg.js";
import { assertFullBleedCanvasAspect } from "../src/framing.js";
import { parseScript } from "../src/parse-script.js";
import {
  digest,
  digestFile,
  digestFull,
  stableConfigJson,
  type ClipInputDigest,
  type RenderReport,
} from "../src/provenance.js";
import type { DemoConfig, TimelineEntry } from "../src/types.js";
import {
  computeSourceBuildAttestation,
  type SourceBuildAttestation,
} from "../src/source-build.js";

type ArtifactName = "master" | "cut-a" | "cut-b" | "cut-c";

type ArtifactContract = {
  sourceParts: string[];
  clipDirName: ArtifactName;
  shotIds: string[];
  clipNames: string[];
  platform: DemoConfig["platform"];
  resolution: { width: number; height: number };
  maxDurationSec: number;
  titleCard: boolean;
  endCard: boolean;
};

const ARTIFACTS: Record<ArtifactName, ArtifactContract> = {
  master: {
    sourceParts: ["master"],
    clipDirName: "master",
    shotIds: [
      "01-cold-open",
      "02-roadmap",
      "03-setup",
      "04-install-it-right",
      "05-first-real-task",
      "06-where-it-runs",
      "07-anywhere-on-a-schedule",
      "08-recap",
      "09-next",
    ],
    clipNames: [
      "01-cold-open.mp4",
      "02-roadmap.mp4",
      "03-setup.mp4",
      "04-install-it-right.mp4",
      "05-first-real-task.mp4",
      "06-where-it-runs.mp4",
      "07-anywhere-on-a-schedule.mp4",
      "08-recap.mp4",
      "09-next.mp4",
    ],
    platform: "landscape",
    resolution: { width: 1920, height: 1080 },
    maxDurationSec: 600,
    titleCard: false,
    endCard: true,
  },
  "cut-a": {
    sourceParts: ["cuts", "cut-a"],
    clipDirName: "cut-a",
    shotIds: ["cut-a-install"],
    clipNames: ["cut-a-install.mp4"],
    platform: "shorts",
    resolution: { width: 1080, height: 1920 },
    maxDurationSec: 60,
    titleCard: false,
    endCard: false,
  },
  "cut-b": {
    sourceParts: ["cuts", "cut-b"],
    clipDirName: "cut-b",
    shotIds: ["cut-b-real-job"],
    clipNames: ["cut-b-real-job.mp4"],
    platform: "shorts",
    resolution: { width: 1080, height: 1920 },
    maxDurationSec: 60,
    titleCard: false,
    endCard: false,
  },
  "cut-c": {
    sourceParts: ["cuts", "cut-c"],
    clipDirName: "cut-c",
    shotIds: ["cut-c-remote"],
    clipNames: ["cut-c-remote.mp4"],
    platform: "shorts",
    resolution: { width: 1080, height: 1920 },
    maxDurationSec: 60,
    titleCard: false,
    endCard: false,
  },
};

const SUPPORT_DOCS = ["CAPTURE_PLAN.md", "CLAIM_LEDGER.md", "PUBLISHING.md", "README.md"] as const;
const CHAPTER_LABELS = new Map([
  ["01-cold-open", "What you'll build"],
  ["02-roadmap", "The 4 steps"],
  ["03-setup", "What you need"],
  ["04-install-it-right", "Step 1: Install it right (2 traps)"],
  ["05-first-real-task", "Step 2: First real task on real files"],
  ["06-where-it-runs", "Step 3: Where Cowork actually runs"],
  ["07-anywhere-on-a-schedule", "Step 4: Web, phone, and schedules"],
  ["08-recap", "Recap"],
  ["09-next", "What's next"],
]);
const EPSILON_SEC = 0.1;

function fail(message: string): never {
  throw new Error(`Factory AI at Work input evidence is invalid: ${message}`);
}

function requireRegularFile(path: string, label: string): string {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail(`${label} is missing at ${path}: ${(error as Error).message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} must be an archived regular file, not a symlink or other file type: ${path}`);
  }
  if (stat.size <= 0) fail(`${label} is empty: ${path}`);
  return path;
}

function optionalRegularFile(path: string, label: string): string | undefined {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    fail(`${label} is inaccessible at ${path}: ${(error as Error).message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} must be an archived regular file, not a symlink or other file type: ${path}`);
  }
  if (stat.size <= 0) fail(`${label} is empty: ${path}`);
  return path;
}

function requireArchivedDirectory(path: string, label: string): string {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    fail(`${label} is missing at ${path}: ${(error as Error).message}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be an archived directory, not a symlink or other file type: ${path}`);
  }
  return path;
}

function readRequiredText(path: string, label: string): string {
  requireRegularFile(path, label);
  return readFileSync(path, "utf8");
}

function requireExactArray(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`${label} must be exactly [${expected.join(", ")}], got [${actual.join(", ")}]`);
  }
}

function requireExactDirectoryEntries(path: string, expected: string[], label: string): void {
  requireArchivedDirectory(path, label);
  requireExactArray(readdirSync(path).sort(), [...expected].sort(), `${label} entries`);
}

function requireFinitePositive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a finite positive number`);
  }
  return value;
}

function expectedTimelineIds(config: DemoConfig, shotIds: string[]): string[] {
  return [
    ...(config.brand?.titleCard ? ["__card-title"] : []),
    ...shotIds,
    ...(config.brand?.endCard ? ["__card-end"] : []),
  ];
}

async function validateTimeline(
  artifact: ArtifactName,
  artifactRoot: string,
  report: RenderReport,
  config: DemoConfig,
  expectedIds: string[],
): Promise<void> {
  if (!Array.isArray(report.timeline?.entries)) fail(`${artifact} report has no timeline entries`);
  const entries = report.timeline.entries as TimelineEntry[];
  requireExactArray(entries.map((entry) => entry?.shotId), expectedIds, `${artifact} timeline IDs`);
  if (report.render?.segments !== entries.length) {
    fail(`${artifact} report segment count does not match its timeline`);
  }

  let nextStart = 0;
  for (const [index, entry] of entries.entries()) {
    const start = entry?.startSec;
    const duration = requireFinitePositive(entry?.durationSec, `${artifact} timeline entry ${index} duration`);
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
      fail(`${artifact} timeline entry ${index} start must be finite and non-negative`);
    }
    if (Math.abs(start - nextStart) > EPSILON_SEC) {
      fail(`${artifact} timeline is not contiguous at ${entry.shotId}`);
    }
    nextStart = start + duration;
  }
  const titleEntry = entries.find((entry) => entry.shotId === "__card-title");
  const endEntry = entries.find((entry) => entry.shotId === "__card-end");
  if (
    (titleEntry && (!config.brand || Math.abs(titleEntry.durationSec - config.brand.titleSec) > EPSILON_SEC)) ||
    (endEntry && (!config.brand || Math.abs(endEntry.durationSec - config.brand.endSec) > EPSILON_SEC))
  ) {
    fail(`${artifact} brand-card timeline duration does not match the archived config`);
  }

  const timelineTotal = requireFinitePositive(report.timeline.totalSec, `${artifact} timeline total`);
  const renderTotal = requireFinitePositive(report.render?.totalSec, `${artifact} render total`);
  if (
    Math.abs(nextStart - timelineTotal) > EPSILON_SEC ||
    Math.abs(renderTotal - timelineTotal) > EPSILON_SEC
  ) {
    fail(`${artifact} timeline entries, timeline total, and render total disagree`);
  }

  const segmentRoot = requireArchivedDirectory(
    join(artifactRoot, "seg"),
    `${artifact} segment directory`,
  );
  const selectedSegments = entries.map((entry, index) => {
    const base = requireRegularFile(
      join(segmentRoot, `seg_${index}.mp4`),
      `${artifact} base segment ${entry.shotId}`,
    );
    return optionalRegularFile(
      join(segmentRoot, `seg_${index}.ext.mp4`),
      `${artifact} extended segment ${entry.shotId}`,
    ) ?? base;
  });
  const concatLines = readRequiredText(
    join(segmentRoot, "list.txt"),
    `${artifact} segment concat list`,
  ).split(/\r?\n/).filter((line) => line.length > 0);
  if (concatLines.length !== selectedSegments.length) {
    fail(`${artifact} segment concat list does not match its timeline length`);
  }
  for (const [index, selected] of selectedSegments.entries()) {
    const expectedLine = `file '${basename(selected)}'`;
    if (concatLines[index] !== expectedLine) {
      fail(
        `${artifact} concat list must select exact relative archived segment ` +
        `names; index ${index} must be ${expectedLine}`,
      );
    }
  }

  const measuredDurations = await Promise.all(
    selectedSegments.map(async (path, index) => {
      try {
        return await probeDurationSec(path);
      } catch (error) {
        fail(
          `${artifact} segment ${entries[index]!.shotId} duration could not be ` +
          `probed at ${path}: ${(error as Error).message}`,
        );
      }
    }),
  );
  for (const [index, measured] of measuredDurations.entries()) {
    const duration = requireFinitePositive(
      measured,
      `${artifact} measured segment ${entries[index]!.shotId} duration`,
    );
    if (Math.abs(duration - entries[index]!.durationSec) > EPSILON_SEC) {
      fail(
        `${artifact} measured segment duration does not match its timeline at ` +
        `${entries[index]!.shotId}`,
      );
    }
  }
}

function validateReportBasics(
  artifact: ArtifactName,
  report: RenderReport,
  config: DemoConfig,
  script: string,
  clips: ClipInputDigest[],
  expectedSourceBuild: SourceBuildAttestation,
): void {
  const stableConfig = stableConfigJson(config);
  if (
    report.inputs?.configHash !== digest(stableConfig) ||
    report.inputs?.scriptHash !== digest(script) ||
    report.inputs?.configSha256 !== digestFull(stableConfig) ||
    report.inputs?.scriptSha256 !== digestFull(script) ||
    JSON.stringify(report.inputs?.clips) !== JSON.stringify(clips)
  ) {
    fail(
      `${artifact} render report input hashes do not match the archived ` +
      "config, script, and ordered clip bytes",
    );
  }
  if (
    report.preflight?.ran !== true ||
    report.preflight?.declined !== false ||
    report.preflight?.findings !== 0 ||
    !Array.isArray(report.preflight?.unverifiedShotIds) ||
    report.preflight.unverifiedShotIds.length !== 0
  ) {
    fail(`${artifact} render report does not prove a clean, fully adjudicated preflight`);
  }
  if (
    report.render?.parity?.ok !== true ||
    !Array.isArray(report.render?.parity?.problems) ||
    report.render.parity.problems.length !== 0
  ) {
    fail(`${artifact} render report does not prove clean parity`);
  }
  if (report.limits?.maxDurationSec !== config.maxDurationSec) {
    fail(`${artifact} render report cap does not match the archived config`);
  }
  if (JSON.stringify(report.voice) !== JSON.stringify(config.voice)) {
    fail(`${artifact} render report voice does not match the archived config`);
  }
  if (
    report.renderedOn !== "local" ||
    report.sourceBuildAttestation?.executionMode !==
      "detached-commit-snapshot" ||
    JSON.stringify(report.sourceBuildAttestation) !==
      JSON.stringify(expectedSourceBuild)
  ) {
    fail(
      `${artifact} render report source-build attestation does not match ` +
      "the production receipt commit",
    );
  }
}

async function validateArtifact(
  root: string,
  artifact: ArtifactName,
  expectedSourceBuild: SourceBuildAttestation,
): Promise<RenderReport> {
  const contract = ARTIFACTS[artifact];
  const sourceRoot = requireArchivedDirectory(join(root, "evidence", "source"), "source evidence directory");
  if (contract.sourceParts[0] === "cuts") {
    requireArchivedDirectory(join(sourceRoot, "cuts"), "cut source evidence directory");
  }
  const sourceDir = join(root, "evidence", "source", ...contract.sourceParts);
  const clipsDir = join(root, "evidence", "clips", contract.clipDirName);
  requireArchivedDirectory(sourceDir, `${artifact} source directory`);
  requireArchivedDirectory(clipsDir, `${artifact} clip directory`);
  requireArchivedDirectory(join(root, artifact), `${artifact} artifact directory`);
  const configPath = requireRegularFile(join(sourceDir, "demo.config.json"), `${artifact} config`);
  const scriptPath = requireRegularFile(join(sourceDir, "DEMO_SCRIPT.md"), `${artifact} script`);
  const reportPath = requireRegularFile(join(root, artifact, "render-report.json"), `${artifact} render report`);

  const config = loadConfig(configPath);
  // Reproduce the production CLI invocation: these two options deliberately
  // replace mutable paths authored in the copied config with attempt-owned
  // absolute paths before preflight, capture, and provenance hashing.
  config.script = scriptPath;
  config.clipsDir = clipsDir;

  if (config.audio.musicPath !== undefined) {
    fail(
      `${artifact} archived config may not use audio.musicPath; ` +
      "Gate 1 permits only the reproducible synthesized sound-design bed",
    );
  }
  if (
    config.platform !== contract.platform ||
    config.resolution.width !== contract.resolution.width ||
    config.resolution.height !== contract.resolution.height ||
    config.maxDurationSec !== contract.maxDurationSec ||
    config.preflight !== true ||
    config.brand?.titleCard !== contract.titleCard ||
    config.brand?.endCard !== contract.endCard
  ) {
    fail(`${artifact} archived config does not match the Gate 1 artifact contract`);
  }

  const script = readRequiredText(scriptPath, `${artifact} script`);
  const manifest = parseScript(script);
  requireExactArray(manifest.shots.map((shot) => shot.id), contract.shotIds, `${artifact} shot IDs`);
  requireExactArray(
    manifest.shots.map((shot) => shot.clip ?? ""),
    contract.clipNames,
    `${artifact} clip declarations`,
  );

  const clipDigests: ClipInputDigest[] = [];
  for (const [index, shot] of manifest.shots.entries()) {
    if (shot.target !== "prebaked" || shot.fullBleed !== true || !shot.clip) {
      fail(`${artifact} shot ${shot.id} must be a full-bleed prebaked clip`);
    }
    const expectedClip = join(clipsDir, contract.clipNames[index]!);
    const resolvedClip = resolveClipPath(shot.clip, config.clipsDir, config.configDir ?? dirname(configPath));
    if (resolvedClip !== expectedClip) {
      fail(`${artifact} shot ${shot.id} resolves outside its archived evidence clip path`);
    }
    requireRegularFile(resolvedClip, `${artifact} clip ${basename(resolvedClip)}`);
    clipDigests.push({ shotId: shot.id, sha256: await digestFile(resolvedClip) });
    const geometry = await probeSizePx(resolvedClip);
    assertFullBleedCanvasAspect(config.resolution, geometry, shot.id);
    if (
      geometry.width !== contract.resolution.width ||
      geometry.height !== contract.resolution.height
    ) {
      fail(
        `${artifact} clip ${basename(resolvedClip)} must be ` +
        `${contract.resolution.width}x${contract.resolution.height} square-pixel display geometry`,
      );
    }
  }

  let report: RenderReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")) as RenderReport;
  } catch (error) {
    fail(`${artifact} render report is not valid JSON: ${(error as Error).message}`);
  }
  validateReportBasics(
    artifact,
    report,
    config,
    script,
    clipDigests,
    expectedSourceBuild,
  );
  await validateTimeline(
    artifact,
    join(root, artifact),
    report,
    config,
    expectedTimelineIds(config, contract.shotIds),
  );
  return report;
}

function validateChapters(root: string, masterReport: RenderReport): void {
  const seen = new Set<string>();
  const expectedLines: string[] = [];
  const chapterEntries: TimelineEntry[] = [];
  for (const entry of masterReport.timeline.entries) {
    const label = CHAPTER_LABELS.get(entry.shotId);
    if (!label) continue;
    if (seen.has(entry.shotId)) fail(`master timeline repeats chapter shot ${entry.shotId}`);
    seen.add(entry.shotId);
    chapterEntries.push(entry);
    const seconds = Math.floor(entry.startSec);
    expectedLines.push(
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} ${label}`,
    );
  }
  const missing = [...CHAPTER_LABELS.keys()].filter((shotId) => !seen.has(shotId));
  if (missing.length > 0) fail(`master timeline is missing chapter shots: ${missing.join(", ")}`);
  for (const [index, entry] of chapterEntries.entries()) {
    const endSec = chapterEntries[index + 1]?.startSec ?? masterReport.timeline.totalSec;
    const durationSec = endSec - entry.startSec;
    if (!Number.isFinite(durationSec) || durationSec < 10) {
      fail(
        `master chapter ${entry.shotId} is shorter than 10 seconds ` +
        `(${durationSec.toFixed(3)}s)`,
      );
    }
  }
  const expected = `${expectedLines.join("\n")}\n`;
  const actual = readRequiredText(join(root, "YOUTUBE_CHAPTERS.txt"), "YouTube chapters");
  if (actual !== expected) {
    fail("YOUTUBE_CHAPTERS.txt was not derived exactly from the archived master timeline");
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 4) {
    throw new Error(
      "usage: pnpm exec tsx scripts/validate-factory-ai-at-work-inputs.ts " +
      "<attempt-or-reviewed-root> <PRODUCTION_RECEIPT.md>",
    );
  }
  const rootArg = resolve(process.argv[2]!);
  let root: string;
  try {
    const stat = lstatSync(rootArg);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`root must be an archived directory, not a symlink or other file type: ${rootArg}`);
    }
    root = realpathSync(rootArg);
  } catch (error) {
    fail(`root is missing or inaccessible at ${rootArg}: ${(error as Error).message}`);
  }

  requireArchivedDirectory(join(root, "evidence"), "evidence directory");
  const productionReceiptPath = resolve(process.argv[3]!);
  if (dirname(productionReceiptPath) !== root) {
    fail("production receipt must be a direct child of the validated root");
  }
  const productionReceipt = readRequiredText(productionReceiptPath, "production receipt");
  const sourceCommitValues = productionReceipt
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- Source commit SHA:"))
    .map((line) => line.slice("- Source commit SHA:".length).trim());
  if (
    sourceCommitValues.length !== 1 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sourceCommitValues[0] ?? "")
  ) {
    fail("production receipt must contain one full Source commit SHA");
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let expectedSourceBuild: SourceBuildAttestation;
  try {
    expectedSourceBuild = await computeSourceBuildAttestation(
      repoRoot,
      sourceCommitValues[0],
    );
  } catch (error) {
    fail(
      `production receipt Source commit SHA cannot produce a source-build attestation: ` +
      `${(error as Error).message}`,
    );
  }
  const sourceRoot = join(root, "evidence", "source");
  const clipsRoot = join(root, "evidence", "clips");
  requireExactDirectoryEntries(
    sourceRoot,
    [...SUPPORT_DOCS, "master", "cuts"],
    "source evidence directory",
  );
  requireExactDirectoryEntries(
    clipsRoot,
    ["master", "cut-a", "cut-b", "cut-c"],
    "clip evidence directory",
  );
  requireExactDirectoryEntries(
    join(sourceRoot, "master"),
    ["DEMO_SCRIPT.md", "demo.config.json"],
    "master source directory",
  );
  requireExactDirectoryEntries(
    join(sourceRoot, "cuts"),
    ["cut-a", "cut-b", "cut-c"],
    "cut source directory",
  );
  for (const doc of SUPPORT_DOCS) {
    requireRegularFile(join(sourceRoot, doc), `support document ${doc}`);
  }
  for (const artifact of ["cut-a", "cut-b", "cut-c"] as const) {
    requireExactDirectoryEntries(
      join(sourceRoot, "cuts", artifact),
      ["DEMO_SCRIPT.md", "demo.config.json"],
      `${artifact} source directory`,
    );
  }
  for (const artifact of Object.keys(ARTIFACTS) as ArtifactName[]) {
    requireExactDirectoryEntries(
      join(clipsRoot, artifact),
      ARTIFACTS[artifact].clipNames,
      `${artifact} clip directory`,
    );
  }
  let masterReport: RenderReport | undefined;
  for (const artifact of Object.keys(ARTIFACTS) as ArtifactName[]) {
    const report = await validateArtifact(root, artifact, expectedSourceBuild);
    if (artifact === "master") masterReport = report;
  }
  if (!masterReport) fail("master render report was not validated");
  validateChapters(root, masterReport);
  console.log(`Factory AI at Work archived inputs validated: ${root}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
