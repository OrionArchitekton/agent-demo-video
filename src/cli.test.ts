import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

const pipelineProbe = vi.hoisted(() => ({
  opts: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./pipeline", () => ({
  runPipeline: vi.fn(async (
    config: { out: string },
    opts: Record<string, unknown>,
  ) => {
    pipelineProbe.opts = opts;
    return {
      outPath: config.out,
      report: { totalSec: 0, segments: 0 },
    };
  }),
}));

import { main, parseCommand } from "./cli";

describe("parseCommand (CLI dispatch)", () => {
  it("routes `login <cfg>` to the login subcommand", () => {
    expect(parseCommand(["login", "my.json"])).toEqual({ cmd: "login", cfgPath: "my.json" });
  });
  it("treats a bare config path as the pipeline run (back-compat)", () => {
    expect(parseCommand(["demo.config.json"])).toEqual({ cmd: "run", cfgPath: "demo.config.json" });
  });
  // A per-run decline of the fail-closed selector gate. The config key is the
  // durable declaration; this flag is the one-off override an operator reaches
  // for, and it must not swallow the config path positional.
  it("accepts --no-preflight as a per-run decline of the selector gate", () => {
    expect(parseCommand(["my.json", "--no-preflight"])).toEqual({ cmd: "run", cfgPath: "my.json", preflight: false });
  });
  it("accepts both fresh --out forms without swallowing the config path", () => {
    expect(parseCommand(["my.json", "--out", "out/attempt-1"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      out: "out/attempt-1",
    });
    expect(parseCommand(["--out=out/attempt-2", "my.json"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      out: "out/attempt-2",
    });
  });
  it("rejects a missing or option-like --out value", () => {
    expect(() => parseCommand(["my.json", "--out"])).toThrow(/--out/);
    expect(() => parseCommand(["my.json", "--out", ""])).toThrow(/--out/);
    expect(() => parseCommand(["my.json", "--out="])).toThrow(/--out/);
    expect(() => parseCommand(["my.json", "--out", "--no-preflight"])).toThrow(/--out/);
  });
  it("accepts both per-run --clips-dir forms without swallowing the config path", () => {
    expect(parseCommand(["my.json", "--clips-dir", "/attempt/evidence/clips"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      clipsDir: "/attempt/evidence/clips",
    });
    expect(parseCommand(["--clips-dir=/attempt/evidence/clips", "my.json"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      clipsDir: "/attempt/evidence/clips",
    });
  });
  it("activates strict clip-root binding only when --clips-dir is supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-demo-video-cli-clips-"));
    const clipsRoot = join(root, "clips");
    const configPath = join(root, "demo.config.json");
    await mkdir(clipsRoot);
    await writeFile(join(root, "DEMO_SCRIPT.md"), "# Demo\n", "utf8");
    await writeFile(
      configPath,
      JSON.stringify({
        script: join(root, "DEMO_SCRIPT.md"),
        dashboardBaseUrl: "http://localhost:3000",
        out: join(root, "out"),
      }),
      "utf8",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      pipelineProbe.opts = undefined;
      await main([configPath]);
      expect(pipelineProbe.opts).not.toHaveProperty("strictClipsRoot");

      pipelineProbe.opts = undefined;
      await main([configPath, "--clips-dir", clipsRoot]);
      expect(pipelineProbe.opts).toMatchObject({
        strictClipsRoot: clipsRoot,
      });
    } finally {
      log.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects invalid --clips-dir values and login use", () => {
    expect(() => parseCommand(["my.json", "--clips-dir"])).toThrow(/--clips-dir/);
    expect(() => parseCommand(["my.json", "--clips-dir="])).toThrow(/--clips-dir/);
    expect(() => parseCommand(["my.json", "--clips-dir", "--out"])).toThrow(/--clips-dir/);
    expect(() => parseCommand(["my.json", "--clips-dir", "evidence/clips"])).toThrow(
      /absolute/,
    );
    expect(() => parseCommand(["login", "my.json", "--clips-dir", "/tmp/clips"])).toThrow(/pipeline run/);
  });
  it("accepts both per-run --script forms and rejects invalid values", () => {
    expect(parseCommand(["my.json", "--script", "/attempt/evidence/DEMO_SCRIPT.md"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      script: "/attempt/evidence/DEMO_SCRIPT.md",
    });
    expect(parseCommand(["--script=/attempt/evidence/DEMO_SCRIPT.md", "my.json"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      script: "/attempt/evidence/DEMO_SCRIPT.md",
    });
    expect(() => parseCommand(["my.json", "--script"])).toThrow(/--script/);
    expect(() => parseCommand(["my.json", "--script="])).toThrow(/--script/);
    expect(() => parseCommand(["my.json", "--script=DEMO_SCRIPT.md"])).toThrow(
      /absolute/,
    );
    expect(() => parseCommand(["login", "my.json", "--script", "/tmp/script.md"])).toThrow(/pipeline run/);
  });
  it("defaults to demo.config.json when no path is given", () => {
    expect(parseCommand([])).toEqual({ cmd: "run", cfgPath: "demo.config.json" });
    expect(parseCommand(["login"])).toEqual({ cmd: "login", cfgPath: "demo.config.json" });
  });
  it("rejects unknown options, surplus positionals, and duplicate singleton flags", () => {
    expect(() =>
      parseCommand(["my.json", "--outt", "out/attempt"]),
    ).toThrow(/unknown option.*--outt/);
    expect(() =>
      parseCommand(["my.json", "other.json"]),
    ).toThrow(/exactly one config path/);
    expect(() =>
      parseCommand(["login", "my.json", "other.json"]),
    ).toThrow(/at most one config path/);
    expect(() =>
      parseCommand(["login", "my.json", "--no-preflight"]),
    ).toThrow(/--no-preflight.*pipeline run/);
    expect(() =>
      parseCommand(["my.json", "--out", "one", "--out=two"]),
    ).toThrow(/--out.*once/);
    expect(() =>
      parseCommand(["my.json", "--no-preflight", "--no-preflight"]),
    ).toThrow(/--no-preflight.*once/);
    expect(() =>
      parseCommand(["my.json", "--attest-source-build", "--attest-source-build"]),
    ).toThrow(/--attest-source-build.*once/);
  });
  it("rejects empty or whitespace-only render hosts", () => {
    expect(() => parseCommand(["my.json", "--render-host", ""])).toThrow(
      /--render-host/,
    );
    expect(() => parseCommand(["my.json", "--render-host", "   "])).toThrow(
      /--render-host/,
    );
    expect(() => parseCommand(["my.json", "--render-host=   "])).toThrow(
      /--render-host/,
    );
  });
  it("accepts --attest-source-build only for a local pipeline run", () => {
    expect(parseCommand(["my.json", "--attest-source-build"])).toEqual({
      cmd: "run",
      cfgPath: "my.json",
      attestSourceBuild: true,
    });
    expect(() => parseCommand(["login", "my.json", "--attest-source-build"])).toThrow(
      /--attest-source-build.*login/,
    );
    expect(() =>
      parseCommand(["my.json", "--attest-source-build", "--render-host", "render.example"]),
    ).toThrow(/--attest-source-build.*--render-host/);
  });
  it("refuses attested mode before loading application modules without the committed launcher", async () => {
    const names = [
      "AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_ROOT",
      "AGENT_DEMO_VIDEO_SOURCE_AUTHORITY_REPO",
      "AGENT_DEMO_VIDEO_SOURCE_SNAPSHOT_COMMIT",
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    try {
      await expect(
        main(["/does/not/exist.json", "--attest-source-build"]),
      ).rejects.toThrow(/committed source snapshot launcher/);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
