import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { LocalTransport, SshTransport } from "../src/transport";
import { DemoConfigSchema } from "../src/types";

async function fixtureConfig(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
  const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
  const scriptPath = join(dir, "demo.md");
  await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
  return DemoConfigSchema.parse({
    script: scriptPath,
    dashboardBaseUrl: "http://localhost:3000",
    out: join(dir, "out"),
    resolution: { width: 1280, height: 720 },
  });
}

describe("runPipeline remote offload (FAKE_TTS)", () => {
  beforeAll(() => {
    process.env.FAKE_TTS = "1";
    execSync("pnpm build:remote-entry", { stdio: "ignore" });
  });

  it("offloads the render to a render host and returns a valid RenderResult", async () => {
    const cfg = await fixtureConfig("pipe-remote-ok-");
    const r = await runPipeline(cfg, { render: { transport: new LocalTransport() } });
    expect(r.outPath.endsWith("final.mp4")).toBe(true);
    expect((await stat(r.outPath)).size).toBeGreaterThan(0);
    expect(r.report.parity.ok).toBe(true);
    expect(r.report.segments).toBeGreaterThan(0);
  }, 120_000);

  it("fails loudly when the render host is unreachable (no silent local fallback)", async () => {
    const cfg = await fixtureConfig("pipe-remote-fail-");
    await expect(
      runPipeline(cfg, { render: { transport: new SshTransport("no-such-host.invalid") } }),
    ).rejects.toThrow();
  }, 120_000);

  it("fails loudly when the render bundle is missing", async () => {
    const cfg = await fixtureConfig("pipe-remote-nobundle-");
    await expect(
      runPipeline(cfg, { render: { transport: new LocalTransport(), bundlePath: "/nonexistent/remote-entry.js" } }),
    ).rejects.toThrow(/remote render bundle not found/);
  }, 120_000);
});

describe("audio.musicPath remote gate (pipeline finding)", () => {
  it("rejects a remote render when sound design would read musicPath", async () => {
    const cfg = await fixtureConfig("pipe-remote-music-");
    (cfg.audio as { musicPath?: string }).musicPath = "/tmp/nope.mp3";
    await expect(runPipeline(cfg, { render: { transport: new LocalTransport() } })).rejects.toThrow(/musicPath/);
  });
  it("does not fire the musicPath gate when sound design is off (the file is never read)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-remote-music-off-"));
    const cfg = DemoConfigSchema.parse({
      script: join(dir, "missing.md"),
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      audio: { soundDesign: false, musicPath: "/tmp/nope.mp3" },
    });
    // The pipeline proceeds past the gate and fails on the missing script instead.
    await expect(runPipeline(cfg, { render: { transport: new LocalTransport() } })).rejects.toThrow(/ENOENT|no such file/i);
  });
});
