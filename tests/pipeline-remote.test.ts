import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rename, stat } from "node:fs/promises";
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
    // Both checks ran locally against the RETRIEVED file.
    const report = JSON.parse(await readFile(join(cfg.out, "render-report.json"), "utf8"));
    expect(report.renderedOn).toBe("remote");
    expect(report.deliverable.ok).toBe(true);
    expect(report.contactSheet.stills).toHaveLength(report.timeline.entries.length);
    expect((await stat(join(cfg.out, report.contactSheet.path))).size).toBeGreaterThan(0);
  }, 120_000);

  it("rejects a retrieved deliverable that breaks the final-format contract and writes no report", async () => {
    // The render host succeeds, but the file the operator receives is not the
    // deliverable: re-encoded to 4:4:4 at 25fps on the way back. Verification must
    // read the retrieved bytes, not trust the host's own report.
    class WrongFormatTransport extends LocalTransport {
      override async pullFile(remoteFile: string, localFile: string): Promise<void> {
        await super.pullFile(remoteFile, localFile);
        const wrong = `${localFile}.wrong.mp4`;
        execFileSync("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error",
          "-i", localFile, "-vf", "fps=25,format=yuv444p", "-c:v", "libx264", "-c:a", "copy", wrong,
        ]);
        await rename(wrong, localFile);
      }
    }
    const cfg = await fixtureConfig("pipe-remote-wrongformat-");
    await expect(runPipeline(cfg, { render: { transport: new WrongFormatTransport() } })).rejects.toThrow(
      /deliverable.*pixel format: expected yuv420p, got yuv444p; .*(?<!average )frame rate: expected 30, got 25\/1; average frame rate: expected 30, got 25\/1/s,
    );
    await expect(stat(join(cfg.out, "render-report.json"))).rejects.toThrow(/ENOENT/);
  }, 120_000);

  it("rejects a retrieved deliverable whose video track ends a second before its intact audio", async () => {
    // The container keeps the full audio length, so only the video stream's own
    // duration can reveal the truncation; reading the container instead must fail here.
    class ShortVideoTransport extends LocalTransport {
      override async pullFile(remoteFile: string, localFile: string): Promise<void> {
        await super.pullFile(remoteFile, localFile);
        const seconds = Number(
          execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", localFile], {
            encoding: "utf8",
          }).trim(),
        );
        const cut = `${localFile}.cut.mp4`;
        execFileSync("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error",
          "-t", String(Math.max(0.5, seconds - 1)), "-i", localFile,
          "-i", localFile,
          "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", cut,
        ]);
        await rename(cut, localFile);
      }
    }
    const cfg = await fixtureConfig("pipe-remote-shortvideo-");
    await expect(runPipeline(cfg, { render: { transport: new ShortVideoTransport() } })).rejects.toThrow(
      // Only the video stream is short: the container (full audio) must still pass,
      // so video duration is the one and only problem named.
      /deliverable contract failed for [^:]*final\.mp4: video duration: [^;]*$/s,
    );
    await expect(stat(join(cfg.out, "render-report.json"))).rejects.toThrow(/ENOENT/);
  }, 120_000);

  it("rejects a host report whose timeline omits a rendered shot, before trusting it", async () => {
    // The host's measured timeline becomes the expectation for the delivered file and
    // the contact-sheet beats, so it must name exactly the shots this run rendered.
    class ForgedTimelineTransport extends LocalTransport {
      override async exec(cwd: string, cmd: string[]): Promise<string> {
        const stdout = await super.exec(cwd, cmd);
        return stdout
          .split("\n")
          .map((line) => {
            try {
              const parsed = JSON.parse(line) as { report?: { timeline: { entries: unknown[]; totalSec: number } } };
              if (!parsed.report) return line;
              parsed.report.timeline.entries = parsed.report.timeline.entries.slice(0, -1);
              return JSON.stringify(parsed);
            } catch {
              return line;
            }
          })
          .join("\n");
      }
    }
    const cfg = await fixtureConfig("pipe-remote-forged-timeline-");
    await expect(runPipeline(cfg, { render: { transport: new ForgedTimelineTransport() } })).rejects.toThrow(
      /render timeline does not match the rendered shots: timeline shots: expected one, two; got one/,
    );
    await expect(stat(join(cfg.out, "render-report.json"))).rejects.toThrow(/ENOENT/);
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
