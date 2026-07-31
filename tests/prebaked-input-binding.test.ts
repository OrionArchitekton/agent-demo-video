import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { digestFull } from "../src/provenance";
import { DemoConfigSchema } from "../src/types";

const PRIVATE_INPUT_ROOT_MARKER_NAME = ".agent-demo-video-private-input-root";
const PRIVATE_INPUT_ROOT_MARKER_CONTENT = "agent-demo-video-private-input-root-v1\n";
const DEAD_RECOVERY_PID = 99_999_999;

async function markPrivateInputRoot(root: string): Promise<void> {
  const marker = join(root, PRIVATE_INPUT_ROOT_MARKER_NAME);
  await writeFile(marker, PRIVATE_INPUT_ROOT_MARKER_CONTENT, {
    encoding: "utf8",
    mode: 0o400,
  });
  await chmod(marker, 0o400);
}

const renderProbe = vi.hoisted(() => ({
  sourcePath: "",
  rawPath: "",
  rawBytes: "",
  rawMode: 0,
  parentMode: 0,
  clickOffsets: [] as number[][],
  failureMessage: "",
}));
const cleanupFault = vi.hoisted(() => ({
  enabled: false,
  retainedPath: "",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      if (
        cleanupFault.enabled &&
        typeof path === "string" &&
        path.includes("agent-demo-video-render-inputs-")
      ) {
        cleanupFault.retainedPath = path;
        throw Object.assign(new Error("injected private-input cleanup failure"), {
          code: "EIO",
        });
      }
      return actual.rm(path, options);
    },
  };
});

vi.mock("../src/render", () => ({
  renderVideo: vi.fn(async (inputs: {
    rawSegments: string[];
    config: { out: string };
    tts: { shotId: string; durationSec: number }[];
    clickOffsets: number[][];
  }) => {
    renderProbe.rawPath = inputs.rawSegments[0]!;
    renderProbe.rawMode = (await stat(renderProbe.rawPath)).mode & 0o777;
    renderProbe.parentMode = (await stat(dirname(renderProbe.rawPath))).mode & 0o777;
    renderProbe.clickOffsets = inputs.clickOffsets;

    // Simulate an ordinary exporter atomically updating the operator-owned
    // source after pipeline admission but before ffmpeg opens its render input.
    await writeFile(renderProbe.sourcePath, "replacement clip bytes", "utf8");
    renderProbe.rawBytes = await readFile(renderProbe.rawPath, "utf8");

    if (renderProbe.failureMessage) {
      throw new Error(renderProbe.failureMessage);
    }

    const durationSec = inputs.tts[0]!.durationSec;
    return {
      outPath: join(inputs.config.out, "final.mp4"),
      report: {
        totalSec: durationSec,
        segments: 1,
        ticks: 0,
        parity: { ok: true, problems: [] },
        timeline: {
          entries: [{ shotId: inputs.tts[0]!.shotId, startSec: 0, durationSec }],
          totalSec: durationSec,
        },
      },
    };
  }),
}));

vi.mock("../src/capture", () => ({
  captureShot: vi.fn(async (
    shot: { id: string },
    _timeline: unknown,
    _config: unknown,
    segDir: string,
  ) => {
    const rawPath = join(segDir, `raw_${shot.id}.webm`);
    await writeFile(rawPath, "captured dashboard bytes", "utf8");
    return rawPath;
  }),
}));

import { PrivateInputCleanupError, runPipeline } from "../src/pipeline";

describe("prebaked render-input binding", () => {
  beforeAll(() => {
    vi.stubEnv("FAKE_TTS", "1");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("renders and attests a private immutable copy when the operator source is replaced", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-"));
    const sourcePath = join(root, "clip.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    const eventsPath = join(root, "out", "seg", "events_one.json");
    const originalBytes = "admitted clip bytes";
    renderProbe.sourcePath = sourcePath;

    await mkdir(dirname(eventsPath), { recursive: true });
    await writeFile(
      eventsPath,
      JSON.stringify([{ kind: "click", tMs: 250 }]),
      "utf8",
    );
    await writeFile(sourcePath, originalBytes, "utf8");
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: prebaked\n- clip: clip.mp4\n- narration: Bound input.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(root, "out"),
      preflight: true,
    });

    await runPipeline(config);

    expect(renderProbe.rawPath).not.toBe(sourcePath);
    expect(renderProbe.rawBytes).toBe(originalBytes);
    expect(renderProbe.parentMode).toBe(0o700);
    expect(renderProbe.rawMode).toBe(0o400);
    expect(renderProbe.clickOffsets).toEqual([[]]);
    await expect(stat(renderProbe.rawPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(eventsPath)).rejects.toMatchObject({ code: "ENOENT" });

    const report = JSON.parse(
      await readFile(join(root, "out", "render-report.json"), "utf8"),
    );
    expect(report.inputs.clips).toEqual([
      { shotId: "one", sha256: digestFull(originalBytes) },
    ]);
  });

  it("fails closed before fresh-output publication when private-input cleanup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-cleanup-"));
    const sourcePath = join(root, "clip.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    const requestedOut = join(root, "fresh-output");
    renderProbe.sourcePath = sourcePath;
    await writeFile(sourcePath, "admitted clip bytes", "utf8");
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: prebaked\n- clip: clip.mp4\n- narration: Cleanup gate.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: requestedOut,
      preflight: true,
    });

    cleanupFault.enabled = true;
    try {
      const failure = await runPipeline(config, { requireFreshOut: true }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({
        name: "PrivateInputCleanupError",
        code: "PRIVATE_INPUT_CLEANUP_FAILED",
      });
      expect(failure).toMatchObject({
        retainedOutputPath: expect.stringContaining(".fresh-output.stage-"),
      });
      expect((await stat((failure as PrivateInputCleanupError).retainedOutputPath!)).isDirectory())
        .toBe(true);
      expect((await stat(requestedOut)).isFile()).toBe(true);
      expect(cleanupFault.retainedPath).toContain("agent-demo-video-render-inputs-");
      expect((await stat(cleanupFault.retainedPath)).isDirectory()).toBe(true);
    } finally {
      cleanupFault.enabled = false;
      if (cleanupFault.retainedPath) {
        await (await import("node:fs/promises")).rm(cleanupFault.retainedPath, {
          recursive: true,
          force: true,
        });
      }
      cleanupFault.retainedPath = "";
    }
  });

  it("preserves the primary pipeline error and classifies a concurrent cleanup failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-primary-"));
    const sourcePath = join(root, "clip.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    const requestedOut = join(root, "fresh-output");
    renderProbe.sourcePath = sourcePath;
    renderProbe.failureMessage = "primary render fault";
    await writeFile(sourcePath, "admitted clip bytes", "utf8");
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: prebaked\n- clip: clip.mp4\n- narration: Preserve primary.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: requestedOut,
      preflight: true,
    });

    cleanupFault.enabled = true;
    try {
      const failure = await runPipeline(config, { requireFreshOut: true }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors[0]).toMatchObject({
        message: "primary render fault",
      });
      expect((failure as AggregateError).errors[1]).toMatchObject({
        name: "PrivateInputCleanupError",
        code: "PRIVATE_INPUT_CLEANUP_FAILED",
        retainedPath: cleanupFault.retainedPath,
      });
      expect((failure as Error).cause).toBe((failure as AggregateError).errors[0]);
      expect((await stat(requestedOut)).isFile()).toBe(true);
    } finally {
      renderProbe.failureMessage = "";
      cleanupFault.enabled = false;
      if (cleanupFault.retainedPath) {
        await (await import("node:fs/promises")).rm(cleanupFault.retainedPath, {
          recursive: true,
          force: true,
        });
      }
      cleanupFault.retainedPath = "";
    }
  });

  it("reports the unpublished fresh-output stage when binding and cleanup both fail", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-aggregate-cleanup-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "prebaked-binding-aggregate-outside-"));
    const validSourcePath = join(root, "valid.mp4");
    const invalidSourcePath = join(root, "invalid.mp4");
    const outsidePath = join(outsideRoot, "outside.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    const requestedOut = join(root, "fresh-output");
    await writeFile(validSourcePath, "admitted clip bytes", "utf8");
    await writeFile(outsidePath, "must not be copied", "utf8");
    await symlink(outsidePath, invalidSourcePath);
    await writeFile(
      scriptPath,
      "# Demo\n" +
        "### SHOT one\n- target: prebaked\n- clip: valid.mp4\n- narration: Bind first input.\n" +
        "### SHOT two\n- target: prebaked\n- clip: invalid.mp4\n- narration: Reject second input.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: requestedOut,
      preflight: true,
    });

    cleanupFault.enabled = true;
    let retainedOutputPath = "";
    try {
      const failure = await runPipeline(config, { requireFreshOut: true }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors[0]).toMatchObject({
        message: expect.stringContaining(
          'could not bind prebaked input for shot "two"',
        ),
      });
      expect((failure as AggregateError).errors[1]).toMatchObject({
        name: "PrivateInputCleanupError",
        code: "PRIVATE_INPUT_CLEANUP_FAILED",
        retainedPath: cleanupFault.retainedPath,
        retainedOutputPath: expect.stringContaining(".fresh-output.stage-"),
      });
      retainedOutputPath = (failure as AggregateError).errors[1].retainedOutputPath;
      expect((await stat(retainedOutputPath)).isDirectory()).toBe(true);
      expect((await stat(requestedOut)).isFile()).toBe(true);
    } finally {
      cleanupFault.enabled = false;
      if (cleanupFault.retainedPath) {
        await (await import("node:fs/promises")).rm(cleanupFault.retainedPath, {
          recursive: true,
          force: true,
        });
      }
      if (retainedOutputPath) {
        await (await import("node:fs/promises")).rm(retainedOutputPath, {
          recursive: true,
          force: true,
        });
      }
      cleanupFault.retainedPath = "";
    }
  });

  it("rejects a symlinked prebaked source without reading its out-of-directory target", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-symlink-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "prebaked-binding-outside-"));
    const sourcePath = join(root, "clip.mp4");
    const outsidePath = join(outsideRoot, "outside.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    await writeFile(outsidePath, "must not be copied", "utf8");
    await symlink(outsidePath, sourcePath);
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: prebaked\n- clip: clip.mp4\n- fullBleed: true\n- narration: Reject symlink.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(root, "out"),
      preflight: true,
    });

    await expect(runPipeline(config)).rejects.toThrow(
      /prebaked source must be a regular, non-symbolic-link file/,
    );
    expect(await readFile(outsidePath, "utf8")).toBe("must not be copied");
  });

  it("does not require a private input temporary root for a dashboard-only render", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-without-prebaked-binding-"));
    const unsafeTmp = await mkdtemp(join(tmpdir(), "dashboard-unsafe-tmp-"));
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    renderProbe.sourcePath = join(root, "operator-marker.txt");
    await writeFile(renderProbe.sourcePath, "unchanged before render", "utf8");
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: dashboard\n- narration: No private input needed.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(root, "out"),
      preflight: false,
    });
    const originalTmpdir = process.env.TMPDIR;
    await chmod(unsafeTmp, 0o777);
    process.env.TMPDIR = unsafeTmp;

    try {
      await expect(runPipeline(config)).resolves.toMatchObject({
        outPath: join(root, "out", "final.mp4"),
      });
      expect(await readdir(unsafeTmp)).toEqual([]);
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      await chmod(unsafeTmp, 0o700);
      await (await import("node:fs/promises")).rm(unsafeTmp, {
        recursive: true,
        force: true,
      });
    }
  });

  it("refuses an unsafe non-sticky TMPDIR before creating a private input root", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-unsafe-tmp-"));
    const unsafeTmp = await mkdtemp(join(tmpdir(), "prebaked-binding-parent-"));
    const sourcePath = join(root, "clip.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    renderProbe.sourcePath = sourcePath;
    await writeFile(sourcePath, "admitted clip bytes", "utf8");
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: prebaked\n- clip: clip.mp4\n- narration: Refuse unsafe temp parent.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(root, "out"),
      preflight: false,
    });
    const originalTmpdir = process.env.TMPDIR;
    await chmod(unsafeTmp, 0o777);
    process.env.TMPDIR = unsafeTmp;

    try {
      await expect(runPipeline(config)).rejects.toThrow(
        /temporary root is not trusted/,
      );
      expect(await readdir(unsafeTmp)).toEqual([]);
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      await chmod(unsafeTmp, 0o700);
      await (await import("node:fs/promises")).rm(unsafeTmp, {
        recursive: true,
        force: true,
      });
    }
  });

  it("refuses a private input temporary root beneath an unsafe ancestor", async () => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-unsafe-ancestor-source-"));
    const unsafeAncestor = await mkdtemp(
      join(tmpdir(), "prebaked-binding-unsafe-ancestor-"),
    );
    const selectedTmp = join(unsafeAncestor, "selected");
    const sourcePath = join(root, "clip.mp4");
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    await mkdir(selectedTmp, { mode: 0o700 });
    await chmod(unsafeAncestor, 0o777);
    await writeFile(sourcePath, "admitted clip bytes", "utf8");
    await writeFile(
      scriptPath,
      "# Demo\n### SHOT one\n- target: prebaked\n- clip: clip.mp4\n- narration: Refuse unsafe temp ancestor.\n",
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(root, "out"),
      preflight: false,
    });
    const originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = selectedTmp;

    try {
      await expect(runPipeline(config)).rejects.toThrow(
        /temporary root ancestor is not trusted/,
      );
      expect(await readdir(selectedTmp)).toEqual([]);
    } finally {
      if (originalTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpdir;
      await chmod(unsafeAncestor, 0o700);
      await (await import("node:fs/promises")).rm(unsafeAncestor, {
        recursive: true,
        force: true,
      });
    }
  });

  it.each([
    ["FIFO", "fifo.mp4"],
    ["device", "/dev/null"],
  ])("rejects a %s prebaked source without blocking", async (_kind, clipName) => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-special-"));
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    if (clipName === "fifo.mp4") {
      execFileSync("mkfifo", [join(root, clipName)]);
    }
    await writeFile(
      scriptPath,
      `# Demo\n### SHOT one\n- target: prebaked\n- clip: ${clipName}\n- narration: Reject special file.\n`,
      "utf8",
    );
    const config = DemoConfigSchema.parse({
      script: scriptPath,
      clipsDir: root,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(root, "out"),
      preflight: false,
    });

    await expect(runPipeline(config)).rejects.toThrow(
      /prebaked source must be a regular, non-symbolic-link file/,
    );
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "removes the private render-input root on catchable %s",
    async (signal) => {
    const root = await mkdtemp(join(tmpdir(), "prebaked-binding-signal-"));
    const scriptPath = join(root, "DEMO_SCRIPT.md");
    const clipPath = join(root, "clip.mp4");
    const configPath = join(root, "demo.config.json");
    const fixtureUrl = pathToFileURL(join(process.cwd(), "tests/fixtures/page.html")).href;
    await writeFile(clipPath, "signal fixture clip", "utf8");
    await writeFile(
      scriptPath,
      `# Demo\n### SHOT source\n- target: prebaked\n- clip: clip.mp4\n- narration: Bind signal fixture.\n### SHOT one\n- target: dashboard\n- narration: Signal cleanup.\n- action: goto url="${fixtureUrl}"\n- action: wait ms=30000\n`,
      "utf8",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        script: scriptPath,
        clipsDir: root,
        dashboardBaseUrl: fixtureUrl,
        out: join(root, "out"),
        preflight: false,
      }),
      "utf8",
    );
    const child = spawn(
      realpathSync(process.execPath),
      [
        "--import",
        "tsx",
        join(process.cwd(), "src/cli.ts"),
        configPath,
      ],
      {
        env: { ...process.env, FAKE_TTS: "1" },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    expect(child.pid).toBeTypeOf("number");
    const childRootPrefix = `agent-demo-video-render-inputs-${child.pid}-`;
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveClose) => child.once("close", (code, signal) => resolveClose({ code, signal })),
    );
    let privateRoot = "";
    try {
      for (let tries = 0; tries < 5_000; tries++) {
        const created = (await readdir(tmpdir())).find(
          (name) => name.startsWith(childRootPrefix),
        );
        if (created) {
          privateRoot = join(tmpdir(), created);
          break;
        }
        if (child.exitCode !== null) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 1));
      }
      expect(privateRoot, stderr).not.toBe("");
      child.kill(signal);
      const exit = await closed;
      const expectedCode = signal === "SIGINT" ? 130 : 143;
      expect(
        exit.code === expectedCode || exit.signal === signal,
        `unexpected ${signal} exit: ${JSON.stringify(exit)}`,
      ).toBe(true);
      await expect(stat(privateRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (privateRoot) {
        await (await import("node:fs/promises")).rm(privateRoot, {
          recursive: true,
          force: true,
        });
      }
    }
    },
    30_000,
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "does not redeliver %s to a pre-existing process listener",
    async (signal) => {
      const root = await mkdtemp(join(tmpdir(), "prebaked-binding-signal-listener-"));
      const scriptPath = join(root, "DEMO_SCRIPT.md");
      const clipPath = join(root, "clip.mp4");
      const configPath = join(root, "demo.config.json");
      const preloaderPath = join(root, "signal-listener.mjs");
      const listenerMarker = join(root, "listener-count.txt");
      const fixtureUrl = pathToFileURL(join(process.cwd(), "tests/fixtures/page.html")).href;
      await writeFile(clipPath, "signal listener fixture clip", "utf8");
      await writeFile(
        scriptPath,
        `# Demo\n### SHOT source\n- target: prebaked\n- clip: clip.mp4\n- narration: Bind signal listener fixture.\n### SHOT one\n- target: dashboard\n- narration: Signal listener cleanup.\n- action: goto url="${fixtureUrl}"\n- action: wait ms=30000\n`,
        "utf8",
      );
      await writeFile(
        configPath,
        JSON.stringify({
          script: scriptPath,
          clipsDir: root,
          dashboardBaseUrl: fixtureUrl,
          out: join(root, "out"),
          preflight: false,
        }),
        "utf8",
      );
      await writeFile(
        preloaderPath,
        [
          'import { writeFileSync } from "node:fs";',
          "let count = 0;",
          `process.on(${JSON.stringify(signal)}, () => {`,
          "  count += 1;",
          `  writeFileSync(${JSON.stringify(listenerMarker)}, String(count));`,
          "  setTimeout(() => process.exit(0), 100);",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      const child = spawn(
        realpathSync(process.execPath),
        [
          "--import",
          "tsx",
          "--import",
          pathToFileURL(preloaderPath).href,
          join(process.cwd(), "src/cli.ts"),
          configPath,
        ],
        {
          env: { ...process.env, FAKE_TTS: "1" },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      expect(child.pid).toBeTypeOf("number");
      const childRootPrefix = `agent-demo-video-render-inputs-${child.pid}-`;
      const closed = new Promise<number | null>((resolveClose) =>
        child.once("close", resolveClose)
      );
      let privateRoot = "";
      try {
        for (let tries = 0; tries < 5_000; tries++) {
          const created = (await readdir(tmpdir())).find(
            (name) => name.startsWith(childRootPrefix),
          );
          const narrationReady = await stat(
            join(root, "out", "audio", "one.mp3"),
          ).then(
            () => true,
            () => false,
          );
          if (created && narrationReady) {
            privateRoot = join(tmpdir(), created);
            break;
          }
          if (child.exitCode !== null) break;
          await new Promise((resolveWait) => setTimeout(resolveWait, 1));
        }
        expect(privateRoot, stderr).not.toBe("");
        child.kill(signal);
        expect(await closed, stderr).toBe(0);
        expect(await readFile(listenerMarker, "utf8")).toBe("1");
        await expect(stat(privateRoot)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (privateRoot) {
          await (await import("node:fs/promises")).rm(privateRoot, {
            recursive: true,
            force: true,
          });
        }
      }
    },
    30_000,
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cleans private inputs before a pre-existing %s listener exits synchronously",
    async (signal) => {
      const root = await mkdtemp(join(tmpdir(), "prebaked-binding-sync-signal-listener-"));
      const scriptPath = join(root, "DEMO_SCRIPT.md");
      const clipPath = join(root, "clip.mp4");
      const configPath = join(root, "demo.config.json");
      const preloaderPath = join(root, "sync-signal-listener.mjs");
      const listenerMarker = join(root, "listener-count.txt");
      const fixtureUrl = pathToFileURL(join(process.cwd(), "tests/fixtures/page.html")).href;
      await writeFile(clipPath, "synchronous signal listener fixture clip", "utf8");
      await writeFile(
        scriptPath,
        `# Demo\n### SHOT source\n- target: prebaked\n- clip: clip.mp4\n- narration: Bind synchronous signal listener fixture.\n### SHOT one\n- target: dashboard\n- narration: Synchronous signal listener cleanup.\n- action: goto url="${fixtureUrl}"\n- action: wait ms=30000\n`,
        "utf8",
      );
      await writeFile(
        configPath,
        JSON.stringify({
          script: scriptPath,
          clipsDir: root,
          dashboardBaseUrl: fixtureUrl,
          out: join(root, "out"),
          preflight: false,
        }),
        "utf8",
      );
      await writeFile(
        preloaderPath,
        [
          'import { writeFileSync } from "node:fs";',
          "let count = 0;",
          `process.on(${JSON.stringify(signal)}, () => {`,
          "  count += 1;",
          `  writeFileSync(${JSON.stringify(listenerMarker)}, String(count));`,
          "  process.exit(0);",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      const child = spawn(
        realpathSync(process.execPath),
        [
          "--import",
          "tsx",
          "--import",
          pathToFileURL(preloaderPath).href,
          join(process.cwd(), "src/cli.ts"),
          configPath,
        ],
        {
          env: { ...process.env, FAKE_TTS: "1" },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      expect(child.pid).toBeTypeOf("number");
      const childRootPrefix = `agent-demo-video-render-inputs-${child.pid}-`;
      const closed = new Promise<number | null>((resolveClose) =>
        child.once("close", resolveClose)
      );
      let privateRoot = "";
      try {
        for (let tries = 0; tries < 5_000; tries++) {
          const created = (await readdir(tmpdir())).find(
            (name) => name.startsWith(childRootPrefix),
          );
          if (created) {
            privateRoot = join(tmpdir(), created);
            break;
          }
          if (child.exitCode !== null) break;
          await new Promise((resolveWait) => setTimeout(resolveWait, 1));
        }
        expect(privateRoot, stderr).not.toBe("");
        child.kill(signal);
        expect(await closed, stderr).toBe(0);
        expect(await readFile(listenerMarker, "utf8")).toBe("1");
        await expect(stat(privateRoot)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (privateRoot) {
          await (await import("node:fs/promises")).rm(privateRoot, {
            recursive: true,
            force: true,
          });
        }
      }
    },
    30_000,
  );

  it("recovers only one explicitly named owned stale render-input root", async () => {
    const staleRoot = await mkdtemp(
      join(
        tmpdir(),
        `agent-demo-video-render-inputs-${DEAD_RECOVERY_PID}-`,
      ),
    );
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await markPrivateInputRoot(staleRoot);
    const runRecovery = () => execFileSync(
      "/usr/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-p",
        recoveryScript,
        "--tmp-root",
        tmpdir(),
        "--older-than-seconds",
        "3600",
        staleRoot,
      ],
      { encoding: "utf8" },
    );

    expect(runRecovery).toThrow(/not old enough/);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(staleRoot, old, old);
    expect(runRecovery()).toContain(`removed stale private render-input root: ${staleRoot}`);
    await expect(stat(staleRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a trailing-slash symlink without deleting through it", async () => {
    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-parent-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-outside-"));
    const marker = join(outsideRoot, "must-survive.txt");
    const staleLink = join(
      selectedTmpRoot,
      "agent-demo-video-render-inputs-stale-symlink",
    );
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await writeFile(marker, "must survive", "utf8");
    await symlink(outsideRoot, staleLink);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(outsideRoot, old, old);

    const runRecovery = () =>
      execFileSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          `${staleLink}/`,
        ],
        { encoding: "utf8" },
      );

    try {
      expect(runRecovery).toThrow();
      expect(await readFile(marker, "utf8")).toBe("must survive");
      expect((await stat(outsideRoot)).isDirectory()).toBe(true);
    } finally {
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
      await (await import("node:fs/promises")).rm(outsideRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("requires privileged Bash startup for stale-root recovery", async () => {
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    const unprivileged = spawnSync("/usr/bin/bash", [recoveryScript], {
      encoding: "utf8",
    });
    expect(unprivileged.status).not.toBe(0);
    expect(unprivileged.stderr).toContain(
      "requires Bash privileged startup mode",
    );

    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-startup-"));
    const staleRoot = await mkdtemp(
      join(
        selectedTmpRoot,
        `agent-demo-video-render-inputs-${DEAD_RECOVERY_PID}-`,
      ),
    );
    const bashEnvironment = join(selectedTmpRoot, "hostile-bash-env");
    const startupMarker = join(selectedTmpRoot, "hostile-startup-ran");
    await writeFile(bashEnvironment, `: > "${startupMarker}"\n`, "utf8");
    await markPrivateInputRoot(staleRoot);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(staleRoot, old, old);

    try {
      const privileged = spawnSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          staleRoot,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, BASH_ENV: bashEnvironment },
        },
      );
      expect(privileged.status, privileged.stderr).toBe(0);
      await expect(stat(startupMarker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("rejects every unexpected character in a recovery target suffix", async () => {
    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-name-"));
    const unexpectedRoot = join(
      selectedTmpRoot,
      "agent-demo-video-render-inputs-x totally-unrelated",
    );
    const marker = join(unexpectedRoot, "must-survive.txt");
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await mkdir(unexpectedRoot, { mode: 0o700 });
    await writeFile(marker, "must survive", "utf8");
    await markPrivateInputRoot(unexpectedRoot);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(unexpectedRoot, old, old);

    const runRecovery = () =>
      execFileSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          unexpectedRoot,
        ],
        { encoding: "utf8" },
      );

    try {
      expect(runRecovery).toThrow(/unexpected render-input root name/);
      expect(await readFile(marker, "utf8")).toBe("must survive");
    } finally {
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("refuses recovery beneath a writable non-sticky temporary root", async () => {
    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-unsafe-"));
    const staleRoot = await mkdtemp(
      join(
        selectedTmpRoot,
        `agent-demo-video-render-inputs-${DEAD_RECOVERY_PID}-`,
      ),
    );
    const marker = join(staleRoot, "must-survive.txt");
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await writeFile(marker, "must survive", "utf8");
    await markPrivateInputRoot(staleRoot);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(staleRoot, old, old);
    await chmod(selectedTmpRoot, 0o777);

    const runRecovery = () =>
      execFileSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          staleRoot,
        ],
        { encoding: "utf8" },
      );

    try {
      expect(runRecovery).toThrow(/temporary root must be trusted/);
      expect(await readFile(marker, "utf8")).toBe("must survive");
    } finally {
      await chmod(selectedTmpRoot, 0o700);
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("refuses a private temporary root beneath an unsafe ancestor", async () => {
    const unsafeAncestor = await mkdtemp(join(tmpdir(), "prebaked-recovery-ancestor-"));
    const selectedTmpRoot = join(unsafeAncestor, "private-tmp");
    await mkdir(selectedTmpRoot, { mode: 0o700 });
    const staleRoot = await mkdtemp(
      join(
        selectedTmpRoot,
        `agent-demo-video-render-inputs-${DEAD_RECOVERY_PID}-`,
      ),
    );
    const marker = join(staleRoot, "must-survive.txt");
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await writeFile(marker, "must survive", "utf8");
    await markPrivateInputRoot(staleRoot);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(staleRoot, old, old);
    await chmod(unsafeAncestor, 0o777);

    const runRecovery = () =>
      execFileSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          staleRoot,
        ],
        { encoding: "utf8" },
      );

    try {
      expect(runRecovery).toThrow(/temporary root ancestor is not trusted/);
      expect(await readFile(marker, "utf8")).toBe("must survive");
    } finally {
      await chmod(unsafeAncestor, 0o700);
      await (await import("node:fs/promises")).rm(unsafeAncestor, {
        recursive: true,
        force: true,
      });
    }
  });

  it("refuses an unmarked directory that only imitates a stale render-input root", async () => {
    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-unmarked-"));
    const imitationRoot = await mkdtemp(
      join(
        selectedTmpRoot,
        `agent-demo-video-render-inputs-${DEAD_RECOVERY_PID}-`,
      ),
    );
    const marker = join(imitationRoot, "must-survive.txt");
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await writeFile(marker, "must survive", "utf8");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(imitationRoot, old, old);

    const runRecovery = () =>
      execFileSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          imitationRoot,
        ],
        { encoding: "utf8" },
      );

    try {
      expect(runRecovery).toThrow(/created-by-pipeline marker/);
      expect(await readFile(marker, "utf8")).toBe("must survive");
    } finally {
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("refuses recovery while the root's owning process is still live", async () => {
    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-live-"));
    const liveRoot = await mkdtemp(
      join(
        selectedTmpRoot,
        `agent-demo-video-render-inputs-${process.pid}-`,
      ),
    );
    const marker = join(liveRoot, "must-survive.txt");
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await writeFile(marker, "must survive", "utf8");
    await markPrivateInputRoot(liveRoot);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(liveRoot, old, old);

    const runRecovery = () =>
      execFileSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          liveRoot,
        ],
        { encoding: "utf8" },
      );

    try {
      expect(runRecovery).toThrow(/owning process is still live/);
      expect(await readFile(marker, "utf8")).toBe("must survive");
    } finally {
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  it("reports committed stale-root deletion as success even when stdout is full", async () => {
    const selectedTmpRoot = await mkdtemp(join(tmpdir(), "prebaked-recovery-output-"));
    const staleRoot = await mkdtemp(
      join(
        selectedTmpRoot,
        `agent-demo-video-render-inputs-${DEAD_RECOVERY_PID}-`,
      ),
    );
    const recoveryScript = join(
      process.cwd(),
      "scripts/cleanup-stale-render-input-root.sh",
    );
    await markPrivateInputRoot(staleRoot);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(staleRoot, old, old);
    const fullOutput = openSync("/dev/full", "w");

    try {
      const recovery = spawnSync(
        "/usr/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-p",
          recoveryScript,
          "--tmp-root",
          selectedTmpRoot,
          "--older-than-seconds",
          "3600",
          staleRoot,
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", fullOutput, "pipe"],
        },
      );
      expect(recovery.status, recovery.stderr).toBe(0);
      await expect(stat(staleRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      closeSync(fullOutput);
      await (await import("node:fs/promises")).rm(selectedTmpRoot, {
        recursive: true,
        force: true,
      });
    }
  });
});
