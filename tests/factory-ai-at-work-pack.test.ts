import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, readFile, rename, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveClipPath } from "../src/clips";
import { loadConfig } from "../src/config";
import { estimateDurationSec } from "../src/fake-tts";
import { parseScript } from "../src/parse-script";
import { captureViewport } from "../src/platforms";
import { runPreflight } from "../src/preflight";
import { digest, digestFull, stableConfigJson } from "../src/provenance";
import {
  computeSourceBuildAttestation,
  type SourceBuildAttestation,
} from "../src/source-build";

const ROOT = "demos/factory-ai-at-work/gate-01";
const MASTER = `${ROOT}/master/demo.config.json`;
const CUTS = [
  `${ROOT}/cuts/cut-a/demo.config.json`,
  `${ROOT}/cuts/cut-b/demo.config.json`,
  `${ROOT}/cuts/cut-c/demo.config.json`,
] as const;
const CONFIGS = [MASTER, ...CUTS] as const;
const CUT_HOOKS: Record<string, string> = {
  [CUTS[0]]: "Two Windows settings decide whether Claude Cowork works at all.",
  [CUTS[1]]: "A real job for Claude Cowork: forty files of Downloads chaos.",
  [CUTS[2]]: "Claude Cowork on Windows may run your task on Anthropic's servers, not your PC.",
};
const DISCLOSURE = "Produced by AI, directed and reviewed by Dan Mercede";
const RECEIPT_VALIDATOR = "scripts/validate-factory-ai-at-work-receipt.sh";
const ATTEMPT_PROMOTER = "scripts/promote-factory-ai-at-work-attempt.sh";
const SOURCE_ATTESTED_LAUNCHER = "scripts/run-source-attested-render.sh";
const NODE_BIN = realpathSync("/usr/bin/node");
const SOURCE_COMMIT = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const VOICE = {
  voiceId: "AwstCxsCY8YE2KYw66By",
  modelId: "eleven_multilingual_v2",
  seed: 42,
  stability: 0.5,
  similarity: 0.75,
};
const CHAPTERS_BYTES = [
  "0:00 What you'll build",
  "0:10 The 4 steps",
  "0:20 What you need",
  "0:30 Step 1: Install it right (2 traps)",
  "0:40 Step 2: First real task on real files",
  "0:50 Step 3: Where Cowork actually runs",
  "1:00 Step 4: Web, phone, and schedules",
  "1:10 Recap",
  "1:20 What's next",
  "",
].join("\n");
const artifactReportBytes = (
  name: string,
  ttsMode: "real" | "fake" = "real",
  inputs = {
    configHash: "a".repeat(16),
    scriptHash: "b".repeat(16),
    configSha256: "a".repeat(64),
    scriptSha256: "b".repeat(64),
    clips: [] as Array<{ shotId: string; sha256: string }>,
  },
  entries: Array<{ shotId: string; startSec: number; durationSec: number }> = [],
  sourceBuildAttestation?: SourceBuildAttestation,
) => {
  const totalSec = entries.length > 0
    ? entries.reduce((total, entry) => total + entry.durationSec, 0)
    : 1;
  return JSON.stringify({
  voice: VOICE,
  ttsMode,
  inputs,
  renderedOn: "local",
  tools: { ffmpeg: "6.1", ffprobe: "6.1", playwright: "1.61.1", node: "v22" },
  timeline: { entries, totalSec },
  render: {
    totalSec,
    segments: entries.length || 1,
    ticks: 0,
    parity: { ok: true, problems: [] },
  },
  limits: { maxDurationSec: name === "master" ? 600 : 60 },
  preflight: { ran: true, declined: false, findings: 0, unverifiedShotIds: [] },
  ...(sourceBuildAttestation ? { sourceBuildAttestation } : {}),
});
};
const sha256Text = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type ArtifactHashes = Record<string, {
  final: string;
  report: string;
  durationSec: number;
  reportBytes: string;
}>;
let mediaFixtures: Promise<{
  landscape: Buffer;
  landscapeEndCard: Buffer;
  landscapeFinal: Buffer;
  portrait: Buffer;
}> | undefined;

async function getMediaFixtures(): Promise<{
  landscape: Buffer;
  landscapeEndCard: Buffer;
  landscapeFinal: Buffer;
  portrait: Buffer;
}> {
  if (!mediaFixtures) {
    mediaFixtures = (async () => {
      const dir = await mkdtemp(join(tmpdir(), "factory-media-fixtures-"));
      const render = (name: string, size: string, durationSec = 1) => {
        const path = join(dir, `${name}.mp4`);
        const result = spawnSync("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error",
          "-f", "lavfi", "-i", `color=c=black:s=${size}:r=30:d=${durationSec}`,
          "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
          "-t", String(durationSec),
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          path,
        ], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`ffmpeg fixture failed: ${result.stderr}`);
        return path;
      };
      const landscapePath = render("landscape", "1920x1080", 10);
      const landscapeEndCardPath = render("landscape-end-card", "1920x1080", 15);
      const landscapeFinalPath = render("landscape-final", "1920x1080", 105);
      const portraitPath = render("portrait", "1080x1920");
      return {
        landscape: await readFile(landscapePath),
        landscapeEndCard: await readFile(landscapeEndCardPath),
        landscapeFinal: await readFile(landscapeFinalPath),
        portrait: await readFile(portraitPath),
      };
    })();
  }
  return mediaFixtures;
}

function loadPack(path: string) {
  const config = loadConfig(path);
  const manifest = parseScript(readFileSync(config.script, "utf8"));
  return { config, manifest };
}

function completeProductionReceipt(
  template: string,
  artifactHashes: ArtifactHashes,
  roots: { attempt: string; reviewed: string },
): string {
  let receipt = template;
  const field = (label: string, value: string) => {
    receipt = receipt.replace(`- ${label}: PENDING`, `- ${label}: ${value}`);
  };
  field("Run ID", "20260730T120000Z-real");
  field("Source commit SHA", SOURCE_COMMIT);
  field("Attempt root", roots.attempt);
  field("Reviewed root", roots.reviewed);
  field("Capture inventory reference", "CAPTURE_PLAN.md R1 through R8");
  field(
    "Claim ledger SHA-256",
    sha256Text(readFileSync(join(roots.attempt, "evidence", "source", "CLAIM_LEDGER.md"))),
  );
  field("Claim source refresh date", "2026-07-30");
  field("Reviewer", "Dan Mercede");
  field("Review start UTC", "2026-07-30T12:00:00Z");
  field("Review stop UTC", "2026-07-30T12:24:00Z");
  field("Total Dan review minutes", "24");
  field("Review decision and rationale", "All four final mixes and evidence passed review.");
  field("Render handoff status", "REVIEWED_FOR_PUBLISH_HANDOFF");
  for (const [name, geometry] of [
    ["master", "1920x1080, SAR 1:1"],
    ["cut-a", "1080x1920, SAR 1:1"],
    ["cut-b", "1080x1920, SAR 1:1"],
    ["cut-c", "1080x1920, SAR 1:1"],
  ] as const) {
    receipt = receipt.replace(
      new RegExp(`^\\| ${name} \\|.*$`, "m"),
      `| ${name} | ${artifactHashes[name]!.final} | ${artifactHashes[name]!.report} | ` +
      `${artifactHashes[name]!.durationSec.toFixed(1)}s | ${geometry} | PASS | REAL | ` +
      "PINNED | PASS | ENFORCED |",
    );
  }
  field("Toolchain versions", "ffmpeg 6.1; ffprobe 6.1; node 22.17; playwright 1.61.1");
  field("YouTube chapters SHA-256", sha256Text(CHAPTERS_BYTES));
  for (let index = 1; index <= 8; index++) {
    receipt = receipt.replace(
      new RegExp(`(^- R${index} .*?: )PENDING$`, "m"),
      `$1verified run evidence ${index}`,
    );
  }
  for (const name of [
    "master full mix, start UTC and stop UTC",
    "01-cold-open",
    "02-roadmap",
    "03-setup",
    "04-install-it-right",
    "05-first-real-task",
    "06-where-it-runs",
    "07-anywhere-on-a-schedule",
    "08-recap",
    "09-next",
    "cut-a full mix and hook, start UTC and stop UTC",
    "cut-b full mix and hook, start UTC and stop UTC",
    "cut-c full mix and hook, start UTC and stop UTC",
  ]) {
    receipt = receipt.replace(
      `| ${name} | PENDING | PENDING |`,
      `| ${name} | reviewed from start to finish at recorded UTC times | PASS |`,
    );
  }
  receipt = receipt
    .replaceAll("- Disposition: PENDING", "- Disposition: PASS")
    .replaceAll("- Operator evidence: PENDING", "- Operator evidence: measured evidence attached")
    .replace(
      "- Planned platform AI-content answers and rationale: PENDING",
      "- Planned platform AI-content answers and rationale: disclose cloned voice and real edited captures",
    );
  return receipt;
}

async function writeProductionArtifacts(root: string): Promise<ArtifactHashes> {
  const media = await getMediaFixtures();
  const sourceBuildAttestation = await computeSourceBuildAttestation(
    resolve("."),
    SOURCE_COMMIT,
  );
  const hashes: ArtifactHashes = {};
  const definitions = [
    {
      name: "master",
      sourceConfig: MASTER,
      archivedSource: join(root, "evidence", "source", "master"),
      clips: join(root, "evidence", "clips", "master"),
    },
    {
      name: "cut-a",
      sourceConfig: CUTS[0],
      archivedSource: join(root, "evidence", "source", "cuts", "cut-a"),
      clips: join(root, "evidence", "clips", "cut-a"),
    },
    {
      name: "cut-b",
      sourceConfig: CUTS[1],
      archivedSource: join(root, "evidence", "source", "cuts", "cut-b"),
      clips: join(root, "evidence", "clips", "cut-b"),
    },
    {
      name: "cut-c",
      sourceConfig: CUTS[2],
      archivedSource: join(root, "evidence", "source", "cuts", "cut-c"),
      clips: join(root, "evidence", "clips", "cut-c"),
    },
  ] as const;

  const sourceRoot = join(root, "evidence", "source");
  await mkdir(sourceRoot, { recursive: true });
  for (const doc of ["CAPTURE_PLAN.md", "CLAIM_LEDGER.md", "PUBLISHING.md", "README.md"]) {
    await writeFile(join(sourceRoot, doc), readFileSync(join(ROOT, doc)));
  }

  await writeFile(join(root, "YOUTUBE_CHAPTERS.txt"), CHAPTERS_BYTES);
  for (const definition of definitions) {
    await mkdir(definition.archivedSource, { recursive: true });
    await mkdir(definition.clips, { recursive: true });
    await mkdir(join(root, definition.name), { recursive: true });

    const sourceScript = definition.sourceConfig.replace("demo.config.json", "DEMO_SCRIPT.md");
    const archivedConfig = join(definition.archivedSource, "demo.config.json");
    const archivedScript = join(definition.archivedSource, "DEMO_SCRIPT.md");
    const scriptBytes = readFileSync(sourceScript);
    await writeFile(archivedConfig, readFileSync(definition.sourceConfig));
    await writeFile(archivedScript, scriptBytes);

    const config = loadConfig(archivedConfig);
    config.script = archivedScript;
    config.clipsDir = definition.clips;
    const manifest = parseScript(scriptBytes.toString("utf8"));
    const clipBytes = definition.name === "master" ? media.landscape : media.portrait;
    for (const shot of manifest.shots) {
      await writeFile(
        join(definition.clips, shot.clip!),
        clipBytes,
      );
    }

    const stableConfig = stableConfigJson(config);
    const script = scriptBytes.toString("utf8");
    const timelineIds = [
      ...(config.brand?.titleCard ? ["__card-title"] : []),
      ...manifest.shots.map((shot) => shot.id),
      ...(config.brand?.endCard ? ["__card-end"] : []),
    ];
    let startSec = 0;
    const entries = timelineIds.map((shotId) => {
      const durationSec = shotId === "__card-title"
        ? config.brand!.titleSec
        : shotId === "__card-end"
          ? config.brand!.endSec
          : definition.name === "master"
            ? 10
            : 1;
      const entry = { shotId, startSec, durationSec };
      startSec += durationSec;
      return entry;
    });
    const reportBytes = artifactReportBytes(
      definition.name,
      "real",
      {
        configHash: digest(stableConfig),
        scriptHash: digest(script),
        configSha256: digestFull(stableConfig),
        scriptSha256: digestFull(script),
        clips: manifest.shots.map((shot) => ({
          shotId: shot.id,
          sha256: sha256Text(clipBytes),
        })),
      },
      entries,
      sourceBuildAttestation,
    );
    const finalBytes = definition.name === "master"
      ? media.landscapeFinal
      : media.portrait;
    const artifactRoot = join(root, definition.name);
    const audioRoot = join(artifactRoot, "audio");
    const segmentRoot = join(artifactRoot, "seg");
    await mkdir(audioRoot);
    await mkdir(segmentRoot);
    await writeFile(join(artifactRoot, ".agent-demo-video-output-claim"), "");
    for (const name of [
      "captions.srt",
      "captions.ass",
      "video.mp4",
      "audio.mp3",
      "muxed.mp4",
    ]) {
      await writeFile(join(artifactRoot, name), `fixture ${definition.name} ${name}\n`);
    }
    for (const name of [
      ...timelineIds.map((shotId) => `${shotId}.mp3`),
      ...timelineIds.map((_, index) => `pad_${index}.mp3`),
      "list.txt",
      "bed.wav",
      "tick.wav",
      "sweep.wav",
      "mix.m4a",
    ]) {
      await writeFile(join(audioRoot, name), `fixture ${definition.name} ${name}\n`);
    }
    const selectedSegmentNames = timelineIds.map(
      (_, index) => `seg_${index}.mp4`,
    );
    await writeFile(
      join(segmentRoot, "list.txt"),
      selectedSegmentNames
        .map((name) => `file '${name}'`)
        .join("\n"),
    );
    for (const [index, name] of selectedSegmentNames.entries()) {
      const segmentBytes = timelineIds[index] === "__card-end"
        ? media.landscapeEndCard
        : definition.name === "master"
          ? media.landscape
          : media.portrait;
      await writeFile(join(segmentRoot, name), segmentBytes);
    }
    if (definition.name === "master") {
      await writeFile(
        join(segmentRoot, "card_title_text.txt"),
        "Factory AI at Work\n",
      );
      await writeFile(
        join(segmentRoot, "card_url_text.txt"),
        "youtube.com/@DanMercedeAI\n",
      );
      await writeFile(
        join(segmentRoot, "card_end.mp4"),
        media.landscapeEndCard,
      );
    }
    await writeFile(join(artifactRoot, "final.mp4"), finalBytes);
    await writeFile(join(artifactRoot, "render-report.json"), reportBytes);
    hashes[definition.name] = {
      final: sha256Text(finalBytes),
      report: sha256Text(reportBytes),
      durationSec: startSec,
      reportBytes,
    };
  }
  return hashes;
}

describe("Factory AI at Work Gate 1 production pack", () => {
  it("pins the approved voice and keeps every product visual on the real-capture seam", async () => {
    const emptyCaptureRoot = await mkdtemp(join(tmpdir(), "factory-gate-01-"));

    for (const path of CONFIGS) {
      const { config, manifest } = loadPack(path);
      const rawConfig = JSON.parse(readFileSync(path, "utf8")) as {
        voice?: unknown;
        audio?: { musicPath?: unknown };
      };
      expect(rawConfig.voice, `${path} must own the production voice pin`).toEqual(VOICE);
      expect(rawConfig.audio?.musicPath, `${path} may not consume unarchived music`).toBeUndefined();
      expect(config.voice).toEqual(VOICE);
      expect(config.preflight).toBe(true);
      expect(config.capture.auth).toBeUndefined();
      expect(manifest.shots.length).toBeGreaterThan(0);
      expect(manifest.shots.every((shot) => shot.target === "prebaked" && shot.fullBleed === true)).toBe(true);
      expect(new Set(manifest.shots.map((shot) => shot.clip)).size).toBe(manifest.shots.length);
      const expectedClipDir = path === MASTER
        ? resolve(ROOT, "clips/master")
        : resolve(ROOT, "clips", path.match(/cut-[abc]/)![0]);
      for (const shot of manifest.shots) {
        expect(resolveClipPath(shot.clip!, config.clipsDir, config.configDir!)).toBe(
          resolve(expectedClipDir, shot.clip!),
        );
      }

      // Cross the exact production pre-spend seam against a guaranteed-empty
      // capture root. Every declared visual must fail closed as one missing
      // operator clip, and no browser or TTS call is needed to prove it.
      config.configDir = emptyCaptureRoot;
      config.clipsDir = ".";
      const findings = await runPreflight(manifest, config);
      expect(findings).toHaveLength(manifest.shots.length);
      expect(findings.every((finding) => finding.kind === "missing-clip" && finding.severity === "blocking")).toBe(true);
    }
  });

  it("cold-opens the master on proof and closes on the 15-second disclosure card", () => {
    const { config, manifest } = loadPack(MASTER);
    expect(config.platform).toBe("landscape");
    expect(config.resolution).toEqual({ width: 1920, height: 1080 });
    expect(config.maxDurationSec).toBe(600);
    expect(config.brand).toMatchObject({
      title: DISCLOSURE,
      accent: "#E68249",
      titleCard: false,
      endCard: true,
      endSec: 15,
    });
    expect(manifest.shots[0]?.id).toBe("01-cold-open");
    const estimatedMasterSec = manifest.shots.reduce(
      (total, shot) => total + estimateDurationSec(shot.narration),
      config.brand!.endSec,
    );
    // Real ElevenLabs narration has run up to 30% longer than FAKE_TTS in this
    // repository. Keep the documented 25% reserve so the first real render
    // does not spend on every block and then fail only at the final cap check.
    expect(estimatedMasterSec).toBeLessThanOrEqual(config.maxDurationSec * 0.75);
  });

  it("ships exactly three self-contained portrait cuts with timing headroom", () => {
    const discoveredCuts = readdirSync(`${ROOT}/cuts`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${ROOT}/cuts/${entry.name}/demo.config.json`)
      .filter((path) => existsSync(path))
      .sort();
    expect(discoveredCuts).toEqual([...CUTS].sort());
    for (const path of CUTS) {
      const { config, manifest } = loadPack(path);
      expect(config.platform).toBe("shorts");
      expect(config.resolution).toEqual({ width: 1080, height: 1920 });
      expect(captureViewport(config)).toEqual({ width: 1920, height: 1080 });
      expect(config.maxDurationSec).toBe(60);
      expect(config.brand?.titleCard).toBe(false);
      expect(config.brand?.endCard).toBe(false);
      expect(manifest.shots[0]?.narration).toContain(CUT_HOOKS[path]);
      expect(manifest.shots.at(-1)?.narration).toContain(
        "Watch the full Cowork walkthrough. Follow Factory AI at Work.",
      );

      const estimatedSec = manifest.shots.reduce(
        (total, shot) => total + estimateDurationSec(shot.narration),
        0,
      );
      expect(estimatedSec).toBeGreaterThanOrEqual(20);
      expect(estimatedSec).toBeLessThanOrEqual(45);
    }
  });

  it("fails receipt promotion closed unless all twelve dispositions pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-receipt-validator-"));
    const template = readFileSync(`${ROOT}/PRODUCTION_RECEIPT_TEMPLATE.md`, "utf8");
    const artifactHashes = await writeProductionArtifacts(dir);
    const completed = completeProductionReceipt(template, artifactHashes, {
      attempt: dir,
      reviewed: join(dir, "reviewed"),
    });
    expect(completed).not.toContain("PENDING");
    const run = (path: string, env: NodeJS.ProcessEnv = process.env) => spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        RECEIPT_VALIDATOR,
        "--node-bin",
        NODE_BIN,
        path,
      ],
      { encoding: "utf8", env },
    );

    const validPath = join(dir, "valid.md");
    await writeFile(validPath, completed);
    const valid = run(validPath);
    expect(valid.status, valid.stderr).toBe(0);
    const minimalEnvironmentValid = run(validPath, {
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
      NODE_OPTIONS: "--require=/definitely/not/a/preload.cjs",
      NODE_PATH: "/definitely/not/a/node/path",
      TSX_TSCONFIG_PATH: "/definitely/not/a/tsconfig.json",
      ELEVENLABS_API_KEY: "must-not-be-needed-for-receipt-validation",
    });
    expect(minimalEnvironmentValid.status, minimalEnvironmentValid.stderr).toBe(0);
    const esbuildOverrideMarker = join(dir, "caller-esbuild-override-ran");
    const esbuildOverride = join(dir, "caller-esbuild-override");
    await writeFile(
      esbuildOverride,
      `#!/usr/bin/env bash\nprintf 'executed\\n' > "${esbuildOverrideMarker}"\nexit 97\n`,
    );
    await chmod(esbuildOverride, 0o755);
    const esbuildScrubbed = run(validPath, {
      ...process.env,
      ESBUILD_BINARY_PATH: esbuildOverride,
    });
    expect(esbuildScrubbed.status, esbuildScrubbed.stderr).toBe(0);
    expect(existsSync(esbuildOverrideMarker)).toBe(false);

    const relativeNode = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        RECEIPT_VALIDATOR,
        "--node-bin",
        "node",
        validPath,
      ],
      { encoding: "utf8" },
    );
    expect(relativeNode.status).not.toBe(0);
    expect(relativeNode.stderr).toContain("Node binary path must be absolute");
    const nonNodeExecutable = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        RECEIPT_VALIDATOR,
        "--node-bin",
        "/usr/bin/true",
        validPath,
      ],
      { encoding: "utf8" },
    );
    expect(nonNodeExecutable.status).not.toBe(0);
    expect(nonNodeExecutable.stderr).toContain(
      "selected executable did not prove it is Node",
    );
    const sentinelSpoof = join(dir, "caller-owned-node-spoof");
    await writeFile(
      sentinelSpoof,
      "#!/usr/bin/env bash\nprintf '%s' agent-demo-video-node-ok\n",
    );
    await chmod(sentinelSpoof, 0o700);
    const spoofedNode = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        RECEIPT_VALIDATOR,
        "--node-bin",
        sentinelSpoof,
        validPath,
      ],
      { encoding: "utf8" },
    );
    expect(spoofedNode.status).not.toBe(0);
    expect(spoofedNode.stderr).toContain(
      "Node binary must be root-owned",
    );

    const masterSegmentList = join(dir, "master", "seg", "list.txt");
    const originalMasterSegmentList = await readFile(masterSegmentList);
    await writeFile(
      masterSegmentList,
      originalMasterSegmentList
        .toString("utf8")
        .replace(
          "file 'seg_0.mp4'",
          "file '/tmp/off-root/seg_0.mp4'",
        ),
    );
    const offRootSegment = run(validPath);
    expect(offRootSegment.status).not.toBe(0);
    expect(offRootSegment.stderr).toContain(
      "concat list must select exact relative archived segment names",
    );
    await writeFile(masterSegmentList, originalMasterSegmentList);

    const archivedMasterScript = join(
      dir,
      "evidence",
      "source",
      "master",
      "DEMO_SCRIPT.md",
    );
    const originalMasterScript = await readFile(archivedMasterScript);
    await writeFile(
      archivedMasterScript,
      Buffer.concat([originalMasterScript, Buffer.from("\nUnreviewed source change.\n")]),
    );
    const sourceMismatch = run(validPath);
    expect(sourceMismatch.status).not.toBe(0);
    expect(sourceMismatch.stderr).toContain("input evidence is invalid");
    await writeFile(archivedMasterScript, originalMasterScript);

    const media = await getMediaFixtures();
    const archivedMasterClip = join(
      dir,
      "evidence",
      "clips",
      "master",
      "01-cold-open.mp4",
    );
    const originalMasterClip = await readFile(archivedMasterClip);
    await writeFile(archivedMasterClip, media.landscapeFinal);
    const substitutedClip = run(validPath);
    expect(substitutedClip.status).not.toBe(0);
    expect(substitutedClip.stderr).toContain("ordered clip bytes");
    await writeFile(archivedMasterClip, originalMasterClip);

    const archivedMasterConfig = join(
      dir,
      "evidence",
      "source",
      "master",
      "demo.config.json",
    );
    const originalMasterConfig = await readFile(archivedMasterConfig);
    const externalMusicConfig = JSON.parse(originalMasterConfig.toString("utf8")) as {
      audio: { musicPath?: string };
    };
    externalMusicConfig.audio.musicPath = "/tmp/unarchived-music.wav";
    await writeFile(archivedMasterConfig, `${JSON.stringify(externalMusicConfig, null, 2)}\n`);
    const externalMusic = run(validPath);
    expect(externalMusic.status).not.toBe(0);
    expect(externalMusic.stderr).toContain("may not use audio.musicPath");
    await writeFile(archivedMasterConfig, originalMasterConfig);

    const archivedClaimLedger = join(dir, "evidence", "source", "CLAIM_LEDGER.md");
    const originalClaimLedger = await readFile(archivedClaimLedger);
    await writeFile(
      archivedClaimLedger,
      readFileSync(join(dir, "evidence", "source", "PUBLISHING.md")),
    );
    const claimLedgerMismatch = run(validPath);
    expect(claimLedgerMismatch.status).not.toBe(0);
    expect(claimLedgerMismatch.stderr).toContain("does not match the archived claim ledger");
    await writeFile(archivedClaimLedger, originalClaimLedger);

    const unresolvedCommitPath = join(dir, "unresolved-commit.md");
    await writeFile(
      unresolvedCommitPath,
      completed.replace(`- Source commit SHA: ${SOURCE_COMMIT}`, `- Source commit SHA: ${"0".repeat(40)}`),
    );
    const unresolvedCommit = run(unresolvedCommitPath);
    expect(unresolvedCommit.status).not.toBe(0);
    expect(unresolvedCommit.stderr).toContain("does not resolve to a commit");

    const alternateGitRoot = join(dir, "alternate-git-authority");
    await mkdir(alternateGitRoot);
    execFileSync("git", ["init", alternateGitRoot], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-C",
        alternateGitRoot,
        "-c",
        "user.email=factory-test@example.test",
        "-c",
        "user.name=Factory Test",
        "commit",
        "--allow-empty",
        "-m",
        "alternate authority",
      ],
      { stdio: "ignore" },
    );
    const alternateCommit = execFileSync(
      "git",
      ["-C", alternateGitRoot, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    const poisonedCommitPath = join(dir, "poisoned-git-authority.md");
    await writeFile(
      poisonedCommitPath,
      completed.replace(
        `- Source commit SHA: ${SOURCE_COMMIT}`,
        `- Source commit SHA: ${alternateCommit}`,
      ),
    );
    const poisonedCommit = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        RECEIPT_VALIDATOR,
        "--node-bin",
        NODE_BIN,
        poisonedCommitPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_DIR: join(alternateGitRoot, ".git"),
          GIT_WORK_TREE: alternateGitRoot,
          GIT_COMMON_DIR: join(alternateGitRoot, ".git"),
        },
      },
    );
    expect(poisonedCommit.status).not.toBe(0);
    expect(poisonedCommit.stderr).toContain(
      "Source commit SHA does not resolve to a commit in the source repository",
    );

    const parentCommit = spawnSync(
      "git",
      ["rev-parse", "--verify", "HEAD^"],
      { encoding: "utf8" },
    );
    if (parentCommit.status === 0) {
      const unrelatedCommitPath = join(dir, "unrelated-commit.md");
      await writeFile(
        unrelatedCommitPath,
        completed.replace(
          `- Source commit SHA: ${SOURCE_COMMIT}`,
          `- Source commit SHA: ${parentCommit.stdout.trim()}`,
        ),
      );
      const unrelatedCommit = run(unrelatedCommitPath);
      expect(unrelatedCommit.status).not.toBe(0);
      expect(unrelatedCommit.stderr).toContain(
        "source-build attestation does not match the production receipt commit",
      );
    }

    const masterReportPath = join(dir, "master", "render-report.json");
    const forgedSourceReport = JSON.parse(
      artifactHashes.master!.reportBytes,
    ) as {
      sourceBuildAttestation: { treeSha256: string };
    };
    forgedSourceReport.sourceBuildAttestation.treeSha256 = "0".repeat(64);
    const forgedSourceReportBytes = JSON.stringify(forgedSourceReport);
    await writeFile(masterReportPath, forgedSourceReportBytes);
    const forgedSourcePath = join(dir, "forged-source-attestation.md");
    await writeFile(
      forgedSourcePath,
      completed.replace(
        artifactHashes.master!.report,
        sha256Text(forgedSourceReportBytes),
      ),
    );
    const forgedSource = run(forgedSourcePath);
    expect(forgedSource.status).not.toBe(0);
    expect(forgedSource.stderr).toContain(
      "source-build attestation does not match the production receipt commit",
    );
    await writeFile(masterReportPath, artifactHashes.master!.reportBytes);

    const redistributedTimelineReport = JSON.parse(
      artifactHashes.master!.reportBytes,
    ) as {
      timeline: {
        entries: Array<{
          shotId: string;
          startSec: number;
          durationSec: number;
        }>;
      };
    };
    redistributedTimelineReport.timeline.entries[0]!.durationSec = 10.2;
    redistributedTimelineReport.timeline.entries[1]!.startSec = 10.2;
    redistributedTimelineReport.timeline.entries[1]!.durationSec = 9.8;
    const redistributedTimelineBytes = JSON.stringify(
      redistributedTimelineReport,
    );
    await writeFile(masterReportPath, redistributedTimelineBytes);
    const redistributedTimelinePath = join(dir, "redistributed-timeline.md");
    await writeFile(
      redistributedTimelinePath,
      completed.replace(
        artifactHashes.master!.report,
        sha256Text(redistributedTimelineBytes),
      ),
    );
    const redistributedTimeline = run(redistributedTimelinePath);
    expect(redistributedTimeline.status).not.toBe(0);
    expect(redistributedTimeline.stderr).toContain(
      "measured segment duration does not match its timeline",
    );
    await writeFile(masterReportPath, artifactHashes.master!.reportBytes);

    const shortChapterReport = JSON.parse(
      artifactHashes.master!.reportBytes,
    ) as {
      timeline: {
        entries: Array<{
          shotId: string;
          startSec: number;
          durationSec: number;
        }>;
      };
    };
    shortChapterReport.timeline.entries[0]!.durationSec = 9.95;
    shortChapterReport.timeline.entries[1]!.startSec = 9.95;
    shortChapterReport.timeline.entries[1]!.durationSec = 10.05;
    const shortChapterReportBytes = JSON.stringify(shortChapterReport);
    const shortChapterBytes = CHAPTERS_BYTES.replace(
      "0:10 The 4 steps",
      "0:09 The 4 steps",
    );
    await writeFile(masterReportPath, shortChapterReportBytes);
    await writeFile(join(dir, "YOUTUBE_CHAPTERS.txt"), shortChapterBytes);
    const shortChapterPath = join(dir, "short-chapter.md");
    await writeFile(
      shortChapterPath,
      completed
        .replace(
          artifactHashes.master!.report,
          sha256Text(shortChapterReportBytes),
        )
        .replace(
          sha256Text(CHAPTERS_BYTES),
          sha256Text(shortChapterBytes),
        ),
    );
    const shortChapter = run(shortChapterPath);
    expect(shortChapter.status).not.toBe(0);
    expect(shortChapter.stderr).toContain(
      "master chapter 01-cold-open is shorter than 10 seconds",
    );
    await writeFile(masterReportPath, artifactHashes.master!.reportBytes);
    await writeFile(join(dir, "YOUTUBE_CHAPTERS.txt"), CHAPTERS_BYTES);

    const failedPath = join(dir, "failed.md");
    await writeFile(failedPath, completed.replace("- Disposition: PASS", "- Disposition: FAIL"));
    const failed = run(failedPath);
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("did not pass");

    const missingPath = join(dir, "missing.md");
    await writeFile(missingPath, completed.replace(/^- Disposition: PASS\n/gm, ""));
    const missing = run(missingPath);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("did not pass");

    const duplicateHeadingPath = join(dir, "duplicate-heading.md");
    await writeFile(
      duplicateHeadingPath,
      completed.replace("### 8. Audio", "### 7. Captions"),
    );
    const duplicateHeading = run(duplicateHeadingPath);
    expect(duplicateHeading.status).not.toBe(0);
    expect(duplicateHeading.stderr).toContain("missing or duplicated");

    const rejectedPath = join(dir, "rejected.md");
    await writeFile(
      rejectedPath,
      completed
        .replace(
          "- Render handoff status: REVIEWED_FOR_PUBLISH_HANDOFF",
          "- Render handoff status: REJECTED",
        )
        .replace(
          "- Review decision and rationale: filled",
          "- Review decision and rationale: expected - Render handoff status: REVIEWED_FOR_PUBLISH_HANDOFF but operator rejected the pack",
        ),
    );
    const rejected = run(rejectedPath);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("exactly one reviewed handoff status");

    const incompletePath = join(dir, "incomplete.md");
    await writeFile(incompletePath, template);
    const incomplete = run(incompletePath);
    expect(incomplete.status).not.toBe(0);
    expect(incomplete.stderr).toContain("PENDING");

    const blankPath = join(dir, "blank.md");
    await writeFile(blankPath, completed.replace("- Reviewer: Dan Mercede", "- Reviewer:"));
    expect(run(blankPath).status).not.toBe(0);

    const blankEvidencePath = join(dir, "blank-evidence.md");
    await writeFile(
      blankEvidencePath,
      completed.replace("- Operator evidence: measured evidence attached", "- Operator evidence:"),
    );
    expect(run(blankEvidencePath).status).not.toBe(0);

    const placeholderEvidencePath = join(dir, "placeholder-evidence.md");
    await writeFile(
      placeholderEvidencePath,
      completed.replace(
        "- Operator evidence: measured evidence attached",
        "- Operator evidence: TBD",
      ),
    );
    const placeholderEvidence = run(placeholderEvidencePath);
    expect(placeholderEvidence.status).not.toBe(0);
    expect(placeholderEvidence.stderr).toContain(
      "placeholder review evidence",
    );
    const hostileRipgrepConfig = join(dir, "ripgrep.conf");
    await writeFile(hostileRipgrepConfig, "--definitely-not-a-real-option\n");
    const configuredPlaceholder = run(placeholderEvidencePath, {
      ...process.env,
      RIPGREP_CONFIG_PATH: hostileRipgrepConfig,
    });
    expect(configuredPlaceholder.status).not.toBe(0);
    expect(configuredPlaceholder.stderr).toContain(
      "placeholder review evidence",
    );

    const hiddenPath = join(dir, "hidden.md");
    await writeFile(hiddenPath, `visible prefix <!--\n${completed}\n-->\nREJECTED\n`);
    const hidden = run(hiddenPath);
    expect(hidden.status).not.toBe(0);
    expect(hidden.stderr).toContain("HTML");

    const negativeTokensPath = join(dir, "negative-tokens.md");
    await writeFile(
      negativeTokensPath,
      completed.replace(
        "| PASS | REAL | PINNED | PASS | ENFORCED |",
        "| not present | not real | PINNED | not ok | not enforced |",
      ),
    );
    expect(run(negativeTokensPath).status).not.toBe(0);

    const fakeReportPath = join(dir, "master", "render-report.json");
    const fakeReport = artifactReportBytes("master", "fake");
    await writeFile(fakeReportPath, fakeReport);
    const fakeReceiptPath = join(dir, "fake-report.md");
    await writeFile(
      fakeReceiptPath,
      completed.replace(
        artifactHashes.master!.report,
        sha256Text(fakeReport),
      ),
    );
    const fakeReportResult = run(fakeReceiptPath);
    expect(fakeReportResult.status).not.toBe(0);
    expect(fakeReportResult.stderr).toContain("real pinned gated output");
    await writeFile(fakeReportPath, artifactHashes.master!.reportBytes);

    const reversedTimePath = join(dir, "reversed-time.md");
    await writeFile(
      reversedTimePath,
      completed
        .replace("- Review start UTC: 2026-07-30T12:00:00Z", "- Review start UTC: 2026-07-30T12:24:00Z")
        .replace("- Review stop UTC: 2026-07-30T12:24:00Z", "- Review stop UTC: 2026-07-30T12:00:00Z"),
    );
    expect(run(reversedTimePath).status).not.toBe(0);

    const wrongGeometryPath = join(dir, "wrong-geometry.md");
    const masterFinalHash = artifactHashes.master!.final;
    const masterReportHash = artifactHashes.master!.report;
    const masterDuration = artifactHashes.master!.durationSec.toFixed(1);
    await writeFile(
      wrongGeometryPath,
      completed.replace(
        `| master | ${masterFinalHash} | ${masterReportHash} | ${masterDuration}s | 1920x1080, SAR 1:1 |`,
        `| master | ${masterFinalHash} | ${masterReportHash} | ${masterDuration}s | 1080x1920, SAR 1:1 |`,
      ),
    );
    expect(run(wrongGeometryPath).status).not.toBe(0);
  });

  it("promotes only a closed read-only file set and detects later mutations or additions", async () => {
    const promoterSource = readFileSync(ATTEMPT_PROMOTER, "utf8");
    const finalRenamePhase = promoterSource.indexOf(
      'factory_promotion_phase="final-rename"',
    );
    const finalRename = promoterSource.indexOf(
      'mv -T --no-clobber -- "$factory_promoting_root" "$factory_reviewed_root"',
    );
    expect(finalRenamePhase).toBeGreaterThan(0);
    expect(finalRenamePhase).toBeLessThan(finalRename);
    expect(promoterSource).toContain("trap - EXIT\n  trap '' HUP INT TERM");
    const missingNodeSelection = spawnSync(
      "/usr/bin/bash",
      ["--noprofile", "--norc", "-p", ATTEMPT_PROMOTER],
      { encoding: "utf8" },
    );
    expect(missingNodeSelection.status).not.toBe(0);
    expect(missingNodeSelection.stderr).toContain("--node-bin");
    const relativeNodeSelection = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        ATTEMPT_PROMOTER,
        "--node-bin",
        "node",
        "--verify",
        "/definitely/not/a/reviewed/root",
      ],
      { encoding: "utf8" },
    );
    expect(relativeNodeSelection.status).not.toBe(0);
    expect(relativeNodeSelection.stderr).toContain("Node binary path must be absolute");
    const nonNodeSelection = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        ATTEMPT_PROMOTER,
        "--node-bin",
        "/usr/bin/true",
        "--verify",
        "/definitely/not/a/reviewed/root",
      ],
      { encoding: "utf8" },
    );
    expect(nonNodeSelection.status).not.toBe(0);
    expect(nonNodeSelection.stderr).toContain(
      "selected executable did not prove it is Node",
    );

    const dir = await mkdtemp(join(tmpdir(), "factory-attempt-promoter-"));
    const template = readFileSync(`${ROOT}/PRODUCTION_RECEIPT_TEMPLATE.md`, "utf8");
    const makeAttempt = async (
      name: string,
      reviewed = join(dir, "reviewed", name),
    ) => {
      const attempt = join(dir, `${name}-attempt`);
      await mkdir(attempt, { recursive: true });
      const hashes = await writeProductionArtifacts(attempt);
      await writeFile(
        join(attempt, "PRODUCTION_RECEIPT.md"),
        completeProductionReceipt(template, hashes, { attempt, reviewed }),
      );
      return { attempt, reviewed };
    };
    const run = (...args: string[]) => spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        ATTEMPT_PROMOTER,
        "--node-bin",
        NODE_BIN,
        ...args,
      ],
      { encoding: "utf8" },
    );

    const unrelated = join(dir, "unrelated");
    await mkdir(unrelated);
    const unrelatedFile = join(unrelated, "keep-writable.txt");
    await writeFile(unrelatedFile, "before");
    expect(run(unrelated, join(dir, "reviewed", "unrelated")).status).not.toBe(0);
    expect(existsSync(join(unrelated, "PRODUCTION_RECEIPT.sha256"))).toBe(false);
    await writeFile(unrelatedFile, "after");
    expect(await readFile(unrelatedFile, "utf8")).toBe("after");

    const unexpected = await makeAttempt("unexpected");
    const unexpectedFile = join(unexpected.attempt, "master", "operator-note.txt");
    await writeFile(unexpectedFile, "must stay writable");
    expect(run(unexpected.attempt, unexpected.reviewed).status).not.toBe(0);
    expect(existsSync(join(unexpected.attempt, "PRODUCTION_RECEIPT.sha256"))).toBe(false);
    await writeFile(unexpectedFile, "still writable");
    expect(await readFile(unexpectedFile, "utf8")).toBe("still writable");

    const directoryAudio = await makeAttempt("directory-audio");
    const expectedAudioFile = join(
      directoryAudio.attempt,
      "master",
      "audio",
      "pad_0.mp3",
    );
    await rename(expectedAudioFile, join(dir, "displaced-pad_0.mp3"));
    await mkdir(expectedAudioFile);
    const directoryAudioRun = run(
      directoryAudio.attempt,
      directoryAudio.reviewed,
    );
    expect(directoryAudioRun.status).not.toBe(0);
    expect(directoryAudioRun.stderr).toContain("must be a regular file");
    expect(existsSync(directoryAudio.attempt)).toBe(true);
    expect(
      existsSync(join(directoryAudio.attempt, "PRODUCTION_RECEIPT.sha256")),
    ).toBe(false);

    const startupBypass = await makeAttempt("startup-bypass");
    await writeFile(
      join(startupBypass.attempt, "PRODUCTION_RECEIPT.md"),
      template,
    );
    const bashEnvironment = join(dir, "promoter-bash-env");
    await writeFile(
      bashEnvironment,
      "bash() { return 0; }\n",
    );
    const startupBypassRun = spawnSync(
      "/usr/bin/bash",
      [
        resolve(ATTEMPT_PROMOTER),
        "--node-bin",
        NODE_BIN,
        startupBypass.attempt,
        startupBypass.reviewed,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BASH_ENV: bashEnvironment,
        },
      },
    );
    expect(startupBypassRun.status).not.toBe(0);
    expect(startupBypassRun.stderr).toContain(
      "requires Bash privileged startup mode",
    );

    const interrupted = await makeAttempt("interrupted");
    const interruptedProcess = spawn(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        ATTEMPT_PROMOTER,
        "--node-bin",
        NODE_BIN,
        interrupted.attempt,
        interrupted.reviewed,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let interruptedStderr = "";
    interruptedProcess.stderr.setEncoding("utf8");
    interruptedProcess.stderr.on("data", (chunk: string) => {
      interruptedStderr += chunk;
    });
    const interruptedExitPromise = new Promise<number | null>((resolveExit) => {
      interruptedProcess.once("close", resolveExit);
    });
    let privatePromotionName: string | undefined;
    for (let tries = 0; tries < 5_000; tries++) {
      let reviewedEntries: string[] = [];
      try {
        reviewedEntries = readdirSync(join(dir, "reviewed"));
      } catch {
        // The promoter has not created the reviewed parent yet.
      }
      privatePromotionName = reviewedEntries.find((name) =>
        name.startsWith(".interrupted.promoting-")
      );
      if (privatePromotionName) {
        interruptedProcess.kill("SIGSTOP");
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        interruptedProcess.kill("SIGTERM");
        interruptedProcess.kill("SIGCONT");
        break;
      }
      if (interruptedProcess.exitCode !== null) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    }
    expect(privatePromotionName).toBeTruthy();
    const interruptedExit = await interruptedExitPromise;
    expect(interruptedExit).toBe(143);
    expect(interruptedStderr).toContain(
      `restored interrupted promotion to ${interrupted.attempt}`,
    );
    expect(existsSync(interrupted.attempt)).toBe(true);
    expect(
      existsSync(join(dir, "reviewed", privatePromotionName!)),
    ).toBe(false);

    const fullStdout = await makeAttempt("full-stdout");
    const fullStdoutFd = openSync("/dev/full", "w");
    const fullStdoutRun = (() => {
      try {
        return spawnSync(
          "/usr/bin/bash",
          [
            "--noprofile",
            "--norc",
            "-p",
            ATTEMPT_PROMOTER,
            "--node-bin",
            NODE_BIN,
            fullStdout.attempt,
            fullStdout.reviewed,
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", fullStdoutFd, "pipe"],
          },
        );
      } finally {
        closeSync(fullStdoutFd);
      }
    })();
    expect(fullStdoutRun.status, fullStdoutRun.stderr).toBe(0);
    expect(run("--verify", fullStdout.reviewed).status).toBe(0);

    const symlinkReal = join(dir, "reviewed", "symlink-real");
    const symlinkAlias = join(dir, "reviewed", "symlink-alias");
    await mkdir(join(dir, "reviewed"), { recursive: true });
    await symlink(symlinkReal, symlinkAlias);
    const symlinkedDestination = await makeAttempt("symlink-destination", symlinkReal);
    const symlinkRun = run(symlinkedDestination.attempt, symlinkAlias);
    expect(symlinkRun.status).not.toBe(0);
    expect(symlinkRun.stderr).toContain("reviewed root may not be a symlink");
    expect(existsSync(symlinkedDestination.attempt)).toBe(true);
    expect(existsSync(join(symlinkedDestination.attempt, "PRODUCTION_RECEIPT.sha256"))).toBe(false);

    if (
      existsSync("/dev/shm") &&
      statSync("/dev/shm").dev !== statSync(dir).dev
    ) {
      const crossFs = await makeAttempt("cross-filesystem");
      const crossFsParent = await mkdtemp("/dev/shm/factory-reviewed-");
      const crossFsRun = run(crossFs.attempt, join(crossFsParent, "reviewed"));
      expect(crossFsRun.status).not.toBe(0);
      expect(crossFsRun.stderr).toContain("different filesystems");
      expect(existsSync(crossFs.attempt)).toBe(true);
      expect(existsSync(join(crossFs.attempt, "PRODUCTION_RECEIPT.sha256"))).toBe(false);
      await writeFile(join(crossFs.attempt, "YOUTUBE_CHAPTERS.txt"), CHAPTERS_BYTES);
    }

    const tampered = await makeAttempt("tampered");
    const media = await getMediaFixtures();
    await writeFile(join(tampered.attempt, "master", "final.mp4"), media.portrait);
    const tamperedRun = run(tampered.attempt, tampered.reviewed);
    expect(tamperedRun.status).not.toBe(0);
    expect(tamperedRun.stderr).toContain("do not match reviewed files");

    const changed = await makeAttempt("changed");
    expect(run(changed.attempt, changed.reviewed).status).toBe(0);
    expect(run("--verify", changed.reviewed).status).toBe(0);
    const localeVerify = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        ATTEMPT_PROMOTER,
        "--node-bin",
        NODE_BIN,
        "--verify",
        changed.reviewed,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LANG: "en_US.utf8",
          LC_ALL: "en_US.utf8",
        },
      },
    );
    expect(localeVerify.status, localeVerify.stderr).toBe(0);
    const changedReceipt = join(changed.reviewed, "PRODUCTION_RECEIPT.md");
    await chmod(changedReceipt, 0o644);
    await writeFile(
      changedReceipt,
      readFileSync(changedReceipt, "utf8").replace(
        "- Render handoff status: REVIEWED_FOR_PUBLISH_HANDOFF",
        "- Render handoff status: REJECTED",
      ),
    );
    expect(run("--verify", changed.reviewed).status).not.toBe(0);

    const added = await makeAttempt("added");
    expect(run(added.attempt, added.reviewed).status).toBe(0);
    await chmod(added.reviewed, 0o755);
    await writeFile(join(added.reviewed, "unreviewed-variant.mp4"), "not reviewed");
    const extra = run("--verify", added.reviewed);
    expect(extra.status).not.toBe(0);
    expect(extra.stderr).toMatch(/sealed read-only|closed match/);

    const optionTarget = join(dir, "--version");
    const optionLike = await makeAttempt("option-like", optionTarget);
    const optionRun = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        resolve(ATTEMPT_PROMOTER),
        "--node-bin",
        NODE_BIN,
        optionLike.attempt,
        "--version",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(optionRun.status, optionRun.stderr).toBe(0);
    expect(run("--verify", optionTarget).status).toBe(0);
  });

  it("streams the fixed launcher into a verified private detached source snapshot", async () => {
    const direct = spawnSync(
      "bash",
      [SOURCE_ATTESTED_LAUNCHER, resolve("."), SOURCE_COMMIT, "--verify-only", "--"],
      { encoding: "utf8" },
    );
    expect(direct.status).not.toBe(0);
    expect(direct.stderr).toContain(
      "launcher must be streamed from the fixed Git commit",
    );

    const fixture = await mkdtemp(join(tmpdir(), "factory-source-launcher-"));
    await mkdir(join(fixture, "src"));
    await mkdir(join(fixture, "scripts"));
    const launcherBytes = readFileSync(SOURCE_ATTESTED_LAUNCHER);
    await writeFile(
      join(fixture, "src/cli.ts"),
      "process.stdout.write('committed runner');\n",
    );
    await writeFile(
      join(fixture, "scripts/remote-entry.ts"),
      "export const remote = true;\n",
    );
    await writeFile(
      join(fixture, "scripts/run-source-attested-render.sh"),
      launcherBytes,
    );
    await chmod(
      join(fixture, "scripts/run-source-attested-render.sh"),
      0o755,
    );
    await writeFile(join(fixture, "package.json"), '{"name":"launcher-fixture"}\n');
    await writeFile(join(fixture, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(fixture, "tsconfig.json"), "{}\n");
    execFileSync("git", ["init", fixture], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-C",
        fixture,
        "-c",
        "user.email=factory-test@example.test",
        "-c",
        "user.name=Factory Test",
        "add",
        ".",
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "git",
      [
        "-C",
        fixture,
        "-c",
        "user.email=factory-test@example.test",
        "-c",
        "user.name=Factory Test",
        "commit",
        "-m",
        "launcher fixture",
      ],
      { stdio: "ignore" },
    );
    const commit = execFileSync(
      "git",
      ["-C", fixture, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    const hookMarker = join(fixture, "mutable-post-checkout-hook-ran");
    const postCheckoutHook = join(fixture, ".git", "hooks", "post-checkout");
    await writeFile(
      postCheckoutHook,
      `#!/bin/sh\n: > "${hookMarker}"\n`,
    );
    await chmod(postCheckoutHook, 0o755);
    await writeFile(
      join(fixture, "src/cli.ts"),
      "process.stdout.write('dirty mutable runner');\n",
    );

    const unprivileged = spawnSync(
      "/usr/bin/bash",
      ["-s", "--", fixture, commit, "--verify-only", "--"],
      {
        encoding: "utf8",
        input: launcherBytes,
      },
    );
    expect(unprivileged.status).not.toBe(0);
    expect(unprivileged.stderr).toContain(
      "launcher requires Bash privileged startup mode",
    );

    const startupMarker = join(fixture, "caller-bash-startup-ran");
    const toolMarker = join(fixture, "caller-selected-tool-ran");
    const tarMarker = join(fixture, "caller-tar-option-ran");
    const maliciousBin = join(fixture, "caller-bin");
    const bashEnvironment = join(fixture, "caller-bash-env");
    const tarAction = join(fixture, "caller-tar-action");
    const hostileGitHome = join(fixture, "caller-git-home");
    const fsmonitorMarker = join(fixture, "caller-fsmonitor-ran");
    const fsmonitor = join(hostileGitHome, "fsmonitor.sh");
    await mkdir(maliciousBin);
    await mkdir(hostileGitHome);
    await writeFile(bashEnvironment, `: > "${startupMarker}"\n`);
    await writeFile(tarAction, `#!/bin/sh\n: > "${tarMarker}"\n`);
    await chmod(tarAction, 0o755);
    await writeFile(
      fsmonitor,
      `#!/bin/sh\n: > "${fsmonitorMarker}"\nexit 0\n`,
    );
    await chmod(fsmonitor, 0o755);
    await writeFile(
      join(hostileGitHome, ".gitconfig"),
      `[core]\n\tfsmonitor = ${fsmonitor}\n`,
    );
    for (const tool of ["git", "realpath", "tar"]) {
      const path = join(maliciousBin, tool);
      await writeFile(path, `#!/bin/sh\n: > "${toolMarker}"\nexit 97\n`);
      await chmod(path, 0o755);
    }

    const streamed = spawnSync(
      "/usr/bin/bash",
      ["--noprofile", "--norc", "-p", "-s", "--", fixture, commit, "--verify-only", "--"],
      {
        encoding: "utf8",
        input: launcherBytes,
        env: {
          ...process.env,
          PATH: maliciousBin,
          HOME: hostileGitHome,
          XDG_CONFIG_HOME: hostileGitHome,
          BASH_ENV: bashEnvironment,
          TAR_OPTIONS:
            `--checkpoint=1 --checkpoint-action=exec=${tarAction}`,
          "BASH_FUNC_git%%":
            `() { : > "${toolMarker}"; /usr/bin/git "$@"; }`,
          GIT_DIR: join(fixture, "caller-selected.git"),
          GIT_COMMON_DIR: join(fixture, "caller-selected-common.git"),
          GIT_WORK_TREE: fixture,
          NODE_OPTIONS: "--require=/definitely/not/a/preload.cjs",
          NODE_PATH: "/definitely/not/a/node/path",
          TSX_TSCONFIG_PATH: "/definitely/not/a/tsconfig.json",
        },
      },
    );
    expect(streamed.status, streamed.stderr).toBe(0);
    expect(streamed.stdout).toContain(
      `verified committed source snapshot ${commit}`,
    );
    expect(readFileSync(join(fixture, "src/cli.ts"), "utf8")).toContain(
      "dirty mutable runner",
    );
    expect(existsSync(hookMarker)).toBe(false);
    expect(existsSync(startupMarker)).toBe(false);
    expect(existsSync(toolMarker)).toBe(false);
    expect(existsSync(tarMarker)).toBe(false);
    expect(existsSync(fsmonitorMarker)).toBe(false);

    const callerRoot = join(fixture, "caller-working-directory");
    const toolchainRoot = join(fixture, "operator-toolchain");
    const invocationMarker = join(fixture, "snapshot-cli-invocation");
    const pnpmInvocationMarker = join(fixture, "snapshot-pnpm-invocation");
    const fakePnpm = join(toolchainRoot, "pnpm.cjs");
    await mkdir(callerRoot);
    await mkdir(toolchainRoot);
    await writeFile(
      join(callerRoot, "tsconfig.json"),
      '{"compilerOptions":{"paths":{"zod":["./caller-selected-module.ts"]}}}\n',
    );
    await writeFile(join(callerRoot, "caller-selected-module.ts"), "throw new Error('caller cwd');\n");
    const fakeTsx = [
      'import { writeFileSync } from "node:fs";',
      "const lines = [",
      "  `cwd=${process.cwd()}`,",
      "  `node_env=${process.env.NODE_ENV ?? \"unset\"}`,",
      "  `tts_secret=${process.env.ELEVENLABS_API_KEY ?? \"unset\"}`,",
      "  `esbuild_binary_path=${process.env.ESBUILD_BINARY_PATH ?? \"unset\"}`,",
      "  ...process.argv.slice(1).map((arg) => `arg=${arg}`),",
      "];",
      `writeFileSync(${JSON.stringify(invocationMarker)}, \`\${lines.join("\\n")}\\n\`);`,
      "",
    ].join("\n");
    await writeFile(
      fakePnpm,
      [
        'const { mkdirSync, writeFileSync } = require("node:fs");',
        "const lines = [",
        "  `node_env=${process.env.NODE_ENV ?? \"unset\"}`,",
        "  `tts_secret=${process.env.ELEVENLABS_API_KEY ?? \"unset\"}`,",
        "  `home=${process.env.HOME ?? \"unset\"}`,",
        "  `xdg_config_home=${process.env.XDG_CONFIG_HOME ?? \"unset\"}`,",
        "  `npm_userconfig=${process.env.NPM_CONFIG_USERCONFIG ?? \"unset\"}`,",
        "  `npm_globalconfig=${process.env.NPM_CONFIG_GLOBALCONFIG ?? \"unset\"}`,",
        "  ...process.argv.slice(1).map((arg) => `arg=${arg}`),",
        "];",
        `writeFileSync(${JSON.stringify(pnpmInvocationMarker)}, \`\${lines.join("\\n")}\\n\`);`,
        'mkdirSync("node_modules/tsx/dist", { recursive: true });',
        `writeFileSync("node_modules/tsx/dist/cli.mjs", ${JSON.stringify(fakeTsx)});`,
        "",
      ].join("\n"),
    );
    const callerOwnedNode = join(toolchainRoot, "caller-owned-node");
    await writeFile(
      callerOwnedNode,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `if [ "\${1:-}" = "${fakePnpm}" ]; then`,
        '  mkdir -p node_modules/tsx/dist',
        "  printf '%s\\n' '// attacker-selected tsx' > node_modules/tsx/dist/cli.mjs",
        "fi",
        "",
      ].join("\n"),
    );
    await chmod(callerOwnedNode, 0o700);
    const callerOwnedNodeRun = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        "-s",
        "--",
        fixture,
        commit,
        "--node-bin",
        callerOwnedNode,
        "--pnpm-cli",
        fakePnpm,
        "--",
        join(callerRoot, "config.json"),
      ],
      {
        cwd: callerRoot,
        encoding: "utf8",
        input: launcherBytes,
        env: process.env,
      },
    );
    expect(callerOwnedNodeRun.status).not.toBe(0);
    expect(callerOwnedNodeRun.stderr).toContain(
      "Node binary must be root-owned",
    );

    const fullLaunch = spawnSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        "-s",
        "--",
        fixture,
        commit,
        "--node-bin",
        NODE_BIN,
        "--pnpm-cli",
        fakePnpm,
        "--",
        join(callerRoot, "config.json"),
      ],
      {
        cwd: callerRoot,
        encoding: "utf8",
        input: launcherBytes,
        env: {
          ...process.env,
          PATH: maliciousBin,
          BASH_ENV: bashEnvironment,
          NODE_ENV: "production",
          ELEVENLABS_API_KEY: "must-reach-render-only",
          TSX_TSCONFIG_PATH: join(callerRoot, "tsconfig.json"),
          ESBUILD_BINARY_PATH: "/usr/bin/false",
        },
      },
    );
    expect(fullLaunch.status, fullLaunch.stderr).toBe(0);
    const invocation = readFileSync(invocationMarker, "utf8");
    const pnpmInvocation = readFileSync(pnpmInvocationMarker, "utf8");
    expect(pnpmInvocation).toContain("node_env=unset");
    expect(pnpmInvocation).toContain("tts_secret=unset");
    expect(pnpmInvocation).toContain("arg=--prod=false");
    expect(pnpmInvocation).toContain("arg=--ignore-pnpmfile");
    expect(pnpmInvocation).toContain("arg=--config.userconfig=/dev/null");
    expect(pnpmInvocation).toContain("arg=--config.globalconfig=/dev/null");
    expect(pnpmInvocation).toMatch(
      /^home=\/tmp\/agent-demo-video-source-snapshot\.[^/]+\/source\/\.package-home$/m,
    );
    expect(pnpmInvocation).toMatch(
      /^xdg_config_home=\/tmp\/agent-demo-video-source-snapshot\.[^/]+\/source\/\.package-config$/m,
    );
    expect(pnpmInvocation).toContain("npm_userconfig=/dev/null");
    expect(pnpmInvocation).toContain("npm_globalconfig=/dev/null");
    expect(invocation).toMatch(
      /^cwd=\/tmp\/agent-demo-video-source-snapshot\.[^/]+\/source$/m,
    );
    expect(invocation).toMatch(
      /arg=\/tmp\/agent-demo-video-source-snapshot\.[^/]+\/source\/tsconfig\.json/,
    );
    expect(invocation).not.toContain(
      `arg=${join(callerRoot, "tsconfig.json")}`,
    );
    expect(invocation).toContain("node_env=unset");
    expect(invocation).toContain("tts_secret=must-reach-render-only");
    expect(invocation).toContain("esbuild_binary_path=unset");
    expect(existsSync(startupMarker)).toBe(false);
    expect(existsSync(toolMarker)).toBe(false);

    const worktreeList = execFileSync(
      "git",
      ["-C", fixture, "worktree", "list", "--porcelain"],
      { encoding: "utf8" },
    );
    expect(worktreeList.match(/^worktree /gm)).toHaveLength(1);

    const heldGitDirectory = join(fixture, ".git-cleanup-failure-fixture");
    const cleanupFailureTsx = [
      'import { renameSync } from "node:fs";',
      `renameSync(${JSON.stringify(join(fixture, ".git"))}, ${JSON.stringify(heldGitDirectory)});`,
      "",
    ].join("\n");
    await writeFile(
      fakePnpm,
      [
        'const { mkdirSync, writeFileSync } = require("node:fs");',
        'mkdirSync("node_modules/tsx/dist", { recursive: true });',
        `writeFileSync("node_modules/tsx/dist/cli.mjs", ${JSON.stringify(cleanupFailureTsx)});`,
        "",
      ].join("\n"),
    );
    let cleanupFailure:
      | ReturnType<typeof spawnSync>
      | undefined;
    try {
      cleanupFailure = spawnSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          "-s",
          "--",
          fixture,
          commit,
          "--node-bin",
          NODE_BIN,
          "--pnpm-cli",
          fakePnpm,
          "--",
          join(callerRoot, "config.json"),
        ],
        {
          cwd: callerRoot,
          encoding: "utf8",
          input: launcherBytes,
          env: process.env,
        },
      );
      expect(cleanupFailure.status).not.toBe(0);
      expect(cleanupFailure.stderr).toContain(
        "source-attested render cleanup failed",
      );
      expect(cleanupFailure.stderr).toMatch(
        /retained snapshot: \/tmp\/agent-demo-video-source-snapshot\.[^/]+\/source/,
      );
    } finally {
      if (existsSync(heldGitDirectory)) {
        await rename(heldGitDirectory, join(fixture, ".git"));
      }
      const registeredWorktrees = execFileSync(
        "git",
        ["-C", fixture, "worktree", "list", "--porcelain"],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length));
      for (const registered of registeredWorktrees) {
        if (registered === fixture) continue;
        execFileSync(
          "git",
          ["-C", fixture, "worktree", "remove", "--force", registered],
          { stdio: "ignore" },
        );
        await rmdir(dirname(registered));
      }
    }
  });

  it("keeps publishing copy disclosed and the complete pack dash-clean", () => {
    const publishing = readFileSync(`${ROOT}/PUBLISHING.md`, "utf8");
    const claimLedger = readFileSync(`${ROOT}/CLAIM_LEDGER.md`, "utf8");
    const receipt = readFileSync(`${ROOT}/PRODUCTION_RECEIPT_TEMPLATE.md`, "utf8");
    const masterScript = readFileSync(`${ROOT}/master/DEMO_SCRIPT.md`, "utf8");
    const cutCScript = readFileSync(`${ROOT}/cuts/cut-c/DEMO_SCRIPT.md`, "utf8");
    const runbook = readFileSync("docs/runbooks/factory-ai-at-work-gate-01-production.md", "utf8");
    const sourceLauncher = readFileSync(SOURCE_ATTESTED_LAUNCHER, "utf8");
    const attemptPromoter = readFileSync(ATTEMPT_PROMOTER, "utf8");
    const receiptValidator = readFileSync(RECEIPT_VALIDATOR, "utf8");
    expect(publishing).toContain(DISCLOSURE);
    expect(publishing).not.toContain("unmodified captures");
    expect(publishing).toMatch(/product\s+states, task results, and timestamps are not fabricated/);
    expect(publishing).not.toMatch(/^\d+:\d{2}\s/m);
    for (const shotId of loadPack(MASTER).manifest.shots.map((shot) => shot.id)) {
      expect(publishing).toContain(shotId);
    }
    expect(claimLedger).toContain("Verified against live primary documentation: 2026-07-30.");
    expect(claimLedger).toContain("Manual, Auto, or Skip");
    expect(claimLedger).toContain("processed on Anthropic's servers");
    expect(masterScript).toContain("the desktop gate limits access, not data residency");
    expect(cutCScript).toContain("the gate limits access, not data residency");
    for (const [number, heading] of [
      [1, "Review economics"],
      [2, "Claims"],
      [3, "Real captures"],
      [4, "Rights"],
      [5, "Dash-clean packaging"],
      [6, "Title and thumbnail"],
      [7, "Captions"],
      [8, "Audio"],
      [9, "Visual integrity"],
      [10, "Disclosure"],
      [11, "Vertical cuts"],
      [12, "Provenance"],
    ] as const) {
      expect(receipt).toContain(`### ${number}. ${heading}`);
    }
    expect(receipt).toContain("Play every final mix from frame 1 through the final frame.");
    expect(receipt).toContain("Claim ledger SHA-256: PENDING");
    expect(receipt).toContain("sourceBuildAttestation.commit");
    expect(receipt).toContain("Planned platform AI-content answers and rationale: PENDING");
    expect(receipt).toContain("sole authority for the three consecutive episode passes");
    expect(runbook).toContain("--out \"$FACTORY_ATTEMPT_ABS/master\"");
    expect(runbook).toContain("--script \"$FACTORY_ATTEMPT_ABS/evidence/source/master/DEMO_SCRIPT.md\"");
    expect(runbook).toContain("--clips-dir \"$FACTORY_ATTEMPT_ABS/evidence/clips/master\"");
    expect(runbook).toContain("--attest-source-build");
    expect(runbook).toContain("scripts/run-source-attested-render.sh");
    expect(runbook).toContain("factory_attested_render");
    expect(runbook).toMatch(/private detached no-checkout\s+worktree/);
    expect(runbook).toContain("root-owned Node binary");
    expect(runbook).toContain("/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C");
    expect(runbook).toContain("/usr/bin/git --no-replace-objects");
    for (const authorityScript of [sourceLauncher, receiptValidator]) {
      expect(authorityScript).toContain("GIT_CONFIG_NOSYSTEM=1");
      expect(authorityScript).toContain("GIT_CONFIG_GLOBAL=/dev/null");
      expect(authorityScript).toContain("core.fsmonitor=false");
    }
    expect(receiptValidator).not.toContain("/usr/bin/node");
    expect(attemptPromoter).toContain("ESBUILD_BINARY_PATH");
    expect(receiptValidator).toContain("ESBUILD_BINARY_PATH");
    expect(sourceLauncher).toContain("ESBUILD_BINARY_PATH");
    expect(runbook).toContain("/usr/bin/doppler run");
    expect(runbook).toContain("/usr/bin/bash --noprofile --norc -p -s --");
    expect(runbook).toContain(
      "LD_PRELOAD= LD_AUDIT= LD_LIBRARY_PATH= \\\n  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C",
    );
    expect(
      runbook.match(/--node-bin "\$FACTORY_NODE_BIN"/g),
    ).toHaveLength(3);
    expect(runbook).toContain("--pnpm-cli \"$FACTORY_PNPM_CLI\"");
    expect(runbook).not.toContain("bash -s --");
    expect(runbook).not.toContain("pnpm demo \"$FACTORY_ATTEMPT_ABS/evidence/source");
    expect(runbook).toContain("clips/master/01-cold-open.mp4");
    expect(runbook).toContain("\"$FACTORY_ATTEMPT_ROOT/evidence/clips/master/\"");
    expect(runbook).not.toContain("../../../../../demos/factory-ai-at-work/gate-01/clips/");
    expect(runbook).toContain("closed-world promoter");
    expect(runbook).toContain("mkdir \"$FACTORY_ATTEMPT_ROOT\"");
    expect(runbook).toContain("PRODUCTION_RECEIPT_TEMPLATE.md");
    expect(runbook).toContain(
      "\"$FACTORY_NODE_BIN\" --input-type=module - \"$FACTORY_ATTEMPT_ROOT\"",
    );
    expect(runbook).not.toMatch(/(?:^|\n)node --input-type=module/);
    expect(runbook).toContain("PRODUCTION_RECEIPT.sha256");
    expect(runbook).toContain("scripts/promote-factory-ai-at-work-attempt.sh");
    expect(runbook).toContain("scripts/cleanup-stale-render-input-root.sh");
    expect(runbook).toContain(
      "LD_PRELOAD= LD_AUDIT= LD_LIBRARY_PATH= \\\n" +
        "  /usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C \\\n" +
        "  /usr/bin/bash --noprofile --norc -p \\\n" +
        "  scripts/cleanup-stale-render-input-root.sh",
    );
    expect(runbook).toContain("PRIVATE_INPUT_CLEANUP_FAILED");
    expect(runbook).toContain("scripts/validate-factory-ai-at-work-inputs.ts");
    expect(runbook).toContain(".agent-demo-video-output-claim");
    expect(runbook).toContain("malicious process with the same Unix identity");
    expect(runbook).toContain("YOUTUBE_CHAPTERS.txt");
    expect(runbook).toContain("shorter than 10 seconds");
    expect(runbook).toContain("does not");
    expect(runbook).toContain("maintain the three-video counter");
    expect(runbook).not.toContain("PUBLICATION_RECEIPT_TEMPLATE.md");
    expect(runbook).not.toContain("YOUTUBE_CHANNEL_HEAD.json");
    expect(runbook).not.toContain("Consecutive clean pass count");
    expect(runbook).not.toContain("cp --no-clobber");
    expect(runbook.match(/set -euo pipefail/g)?.length).toBeGreaterThanOrEqual(4);
    expect(runbook).toContain("timeline.entries");

    const textFiles = [
      `${ROOT}/README.md`,
      `${ROOT}/CAPTURE_PLAN.md`,
      `${ROOT}/CLAIM_LEDGER.md`,
      `${ROOT}/PUBLISHING.md`,
      `${ROOT}/PRODUCTION_RECEIPT_TEMPLATE.md`,
      "docs/runbooks/factory-ai-at-work-gate-01-production.md",
      "scripts/validate-factory-ai-at-work-inputs.ts",
      SOURCE_ATTESTED_LAUNCHER,
      RECEIPT_VALIDATOR,
      ATTEMPT_PROMOTER,
      "src/git-environment.ts",
      "src/source-build.ts",
      ...CONFIGS,
      ...CONFIGS.map((path) => path.replace("demo.config.json", "DEMO_SCRIPT.md")),
    ];
    for (const path of textFiles) {
      expect(readFileSync(path, "utf8"), `${path} contains a banned Unicode dash`).not.toMatch(/[\u2013\u2014\u2015]/);
    }
  });
});
