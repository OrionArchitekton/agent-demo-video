import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRenderReport,
  digest,
  digestFile,
  digestFull,
  persistRenderReport,
  stableConfigJson,
} from "./provenance";
import type { SourceBuildAttestation } from "./source-build";

/**
 * A judged 2:57 cut re-rendered to 3:25 from the SAME script. It was recorded as
 * TTS nondeterminism; it was actually an unpinned voice model default changing
 * under the render. Nothing in the output recorded which voice produced it, so
 * the question "is this video reproducible from the current script?" had no
 * answer. The report is that answer.
 */
describe("buildRenderReport", () => {
  const base = {
    voice: { voiceId: "v1", modelId: "eleven_multilingual_v2", seed: 42, stability: 0.5, similarity: 0.75 },
    ttsMode: "real" as const,
    configHash: "cfg", scriptHash: "scr",
    configSha256: "c".repeat(64),
    scriptSha256: "s".repeat(64),
    clips: [
      { shotId: "s1", sha256: "1".repeat(64) },
      { shotId: "s2", sha256: "2".repeat(64) },
    ],
    tools: { ffmpeg: "6.0", ffprobe: "6.0", playwright: "1.61.1", node: "v22" },
    timeline: { entries: [{ shotId: "s1", startSec: 0, durationSec: 3 }], totalSec: 3 },
    render: { totalSec: 3, segments: 1, ticks: 0, parity: { ok: true, problems: [] } },
    maxDurationSec: 300,
    renderedOn: "local" as const,
    preflight: { ran: true, declined: false, findings: 0, unverifiedShotIds: [] as string[] },
  };

  it("records the resolved voice, so two renders can be compared to explain a runtime change", () => {
    const r = buildRenderReport(base);
    expect(r.voice.modelId).toBe("eleven_multilingual_v2");
    expect(r.voice.seed).toBe(42);
    expect(r.ttsMode).toBe("real");
  });

  it("records input digests and the per-shot timeline", () => {
    const r = buildRenderReport(base);
    expect(r.inputs.configHash).toBe("cfg");
    expect(r.inputs.scriptHash).toBe("scr");
    expect(r.inputs.configSha256).toBe("c".repeat(64));
    expect(r.inputs.scriptSha256).toBe("s".repeat(64));
    expect(r.inputs.clips.map((clip) => clip.shotId)).toEqual(["s1", "s2"]);
    expect(r.timeline.entries[0]?.shotId).toBe("s1");
    expect(r.timeline.totalSec).toBe(3);
  });

  it("names the host that rendered, so local tool versions are not misread as the renderer's", () => {
    expect(buildRenderReport(base).renderedOn).toBe("local");
    expect(buildRenderReport({ ...base, renderedOn: "remote" as const }).renderedOn).toBe("remote");
  });

  it("carries an optional source-build attestation through unchanged", () => {
    const sourceBuildAttestation: SourceBuildAttestation = {
      version: 2,
      executionMode: "detached-commit-snapshot",
      commit: "a".repeat(40),
      runner: "src/cli.ts",
      scopedPaths: [
        "src",
        "scripts/remote-entry.ts",
        "scripts/run-source-attested-render.sh",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
      ],
      treeSha256: "b".repeat(64),
      packageJsonSha256: "c".repeat(64),
      pnpmLockSha256: "d".repeat(64),
    };
    const report = buildRenderReport({ ...base, sourceBuildAttestation });
    expect(report.sourceBuildAttestation).toBe(sourceBuildAttestation);
    expect(buildRenderReport(base).sourceBuildAttestation).toBeUndefined();
  });

  it("digests content stably and distinguishes different content", () => {
    expect(digest("a")).toBe(digest("a"));
    expect(digest("a")).not.toBe(digest("b"));
    expect(digest("a")).toHaveLength(16);
    expect(digestFull("a")).toHaveLength(64);
    expect(digestFull("a").startsWith(digest("a"))).toBe(true);
  });

  it("streams a file into the same full digest as its exact bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "provenance-digest-"));
    const path = join(dir, "clip.mp4");
    await writeFile(path, "exact clip bytes");
    await expect(digestFile(path)).resolves.toBe(digestFull("exact clip bytes"));
  });

  it("fails closed on an attested report write but preserves legacy best-effort writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "provenance-write-"));
    const missingPath = join(dir, "missing", "render-report.json");
    const report = buildRenderReport(base);

    await expect(
      persistRenderReport(missingPath, report, true),
    ).rejects.toThrow(/required render-report\.json/);

    const warnings: string[] = [];
    const previousWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      await expect(
        persistRenderReport(missingPath, report, false),
      ).resolves.toBeUndefined();
    } finally {
      console.warn = previousWarn;
    }
    expect(warnings).toEqual([
      expect.stringMatching(/could not write render-report\.json/),
    ]);
  });
});

describe("stableConfigJson", () => {
  const base = { script: "DEMO.md", clipsDir: "clips/prebaked", out: "out" } as never;
  const mk = (o: Record<string, unknown>) => ({ ...(base as object), ...o }) as never;

  it("gives the same digest for a local fixture base across two checkouts", () => {
    const a = mk({ dashboardBaseUrl: "file:///home/alice/wt-1/demos/smoke" });
    const b = mk({ dashboardBaseUrl: "file:///home/bob/some/other/path/demos/smoke" });
    expect(digest(stableConfigJson(a))).toBe(digest(stableConfigJson(b)));
  });

  it("still distinguishes two genuinely different remote bases", () => {
    const a = mk({ dashboardBaseUrl: "http://localhost:3000" });
    const b = mk({ dashboardBaseUrl: "http://localhost:4000" });
    expect(digest(stableConfigJson(a))).not.toBe(digest(stableConfigJson(b)));
  });

  it("ignores the machine-local auth profile directory", () => {
    const a = mk({ dashboardBaseUrl: "http://x", capture: { auth: { loginUrl: "https://app/login", profileDir: "/home/alice/.cache/agent-demo-video" } } });
    const b = mk({ dashboardBaseUrl: "http://x", capture: { auth: { loginUrl: "https://app/login", profileDir: "/home/bob/.cache/agent-demo-video" } } });
    expect(digest(stableConfigJson(a))).toBe(digest(stableConfigJson(b)));
  });

  it("normalises the per-attempt script location relative to its copied config", () => {
    const a = mk({ dashboardBaseUrl: "http://x", configDir: "/attempt/run-001/evidence/master", script: "/attempt/run-001/evidence/master/DEMO_SCRIPT.md" });
    const b = mk({ dashboardBaseUrl: "http://x", configDir: "/attempt/run-002/evidence/master", script: "/attempt/run-002/evidence/master/DEMO_SCRIPT.md" });
    expect(digest(stableConfigJson(a))).toBe(digest(stableConfigJson(b)));
  });

  it("normalises the per-attempt clips location relative to its copied config", () => {
    const a = mk({ dashboardBaseUrl: "http://x", configDir: "/attempt/run-001/evidence/master", clipsDir: "/attempt/run-001/evidence/clips" });
    const b = mk({ dashboardBaseUrl: "http://x", configDir: "/attempt/run-002/evidence/master", clipsDir: "/attempt/run-002/evidence/clips" });
    expect(digest(stableConfigJson(a))).toBe(digest(stableConfigJson(b)));
  });

  it("still distinguishes different clip relationships when no content manifest exists", () => {
    const a = mk({ dashboardBaseUrl: "http://x", configDir: "/attempt/run/evidence/master", clipsDir: "/attempt/run/evidence/clips-a" });
    const b = mk({ dashboardBaseUrl: "http://x", configDir: "/attempt/run/evidence/master", clipsDir: "/attempt/run/evidence/clips-b" });
    expect(digest(stableConfigJson(a))).not.toBe(digest(stableConfigJson(b)));
  });
});
