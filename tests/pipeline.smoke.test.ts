import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, writeFile, readFile, rename, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "../src/pipeline";
import { probeDurationSec } from "../src/ffmpeg";
import { DemoConfigSchema } from "../src/types";

describe("runPipeline (smoke, FAKE_TTS)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("produces final.mp4 from a 2-shot script + fixture page", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe's-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), resolution: { width: 1280, height: 720 } });
    const r = await runPipeline(cfg, { requireFreshOut: true });
    expect(r.outPath.endsWith("final.mp4")).toBe(true);
    expect((await stat(r.outPath)).size).toBeGreaterThan(0);
    expect(r.report.parity.ok).toBe(true);
    expect(await probeDurationSec(r.outPath)).toBeLessThanOrEqual(cfg.maxDurationSec);

    // S4: the receipt must actually be written. Deleting the write previously
    // left the whole suite green.
    const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
    expect(report.ttsMode).toBe("fake");
    expect(report.limits.maxDurationSec).toBe(300);
    expect(report.voice.modelId).toBe(cfg.voice.modelId);
    expect(report.timeline.entries.length).toBe(r.report.segments);
    // The recorded timeline must be the MEASURED one, so it can explain a
    // runtime change rather than restating the narration estimate.
    expect(report.timeline.totalSec).toBeCloseTo(r.report.totalSec, 3);
    // The deliverable contract is read from the encoded file, not the config.
    expect(report.deliverable.ok).toBe(true);
    expect(report.deliverable.problems).toEqual([]);
    expect(report.deliverable.probed).toMatchObject({
      videoCodec: "h264",
      pixFmt: "yuv420p",
      width: 1280,
      height: 720,
      frameRate: "30/1",
      avgFrameRate: "30/1",
      sampleAspectRatio: "1:1",
      audioCodec: "aac",
      videoStreams: 1,
      audioStreams: 1,
    });
    expect(Math.abs(report.deliverable.probed.durationSec - report.timeline.totalSec)).toBeLessThanOrEqual(1 / 30);
    // Every recorded field must equal an independent read of the delivered file.
    const independent = JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", r.outPath], { encoding: "utf8" }),
    ) as { streams: Array<Record<string, string | number>>; format: { duration: string } };
    const videos = independent.streams.filter((st) => st.codec_type === "video");
    const audios = independent.streams.filter((st) => st.codec_type === "audio");
    const [v, a] = [videos[0]!, audios[0]!];
    expect(report.deliverable.probed).toEqual({
      videoStreams: videos.length,
      audioStreams: audios.length,
      videoCodec: v.codec_name,
      pixFmt: v.pix_fmt,
      width: v.width,
      height: v.height,
      frameRate: v.r_frame_rate,
      avgFrameRate: v.avg_frame_rate,
      sampleAspectRatio: v.sample_aspect_ratio,
      audioCodec: a.codec_name,
      durationSec: Number(independent.format.duration),
      videoDurationSec: Number(v.duration),
      audioDurationSec: Number(a.duration),
      audioSampleRate: Number(a.sample_rate),
      // No display matrix or rotate tag on the delivered stream.
      rotationDeg: 0,
    });
    expect(v.side_data_list).toBeUndefined();
    expect((v.tags as unknown as Record<string, string> | undefined)?.rotate).toBeUndefined();
    // The audio track ends before the container, so a probe reading the wrong
    // duration field cannot pass the equality above.
    expect(Number(a.duration)).toBeLessThan(Number(independent.format.duration));
    // The padded mux keeps every video frame: the track is frame-exact.
    expect(Math.abs(report.deliverable.probed.videoDurationSec - report.timeline.totalSec)).toBeLessThanOrEqual(1 / 30);

    // Contact sheet: one still per measured timeline entry, at the shot's midpoint,
    // tiled in timeline order beside the deliverable, geometry verified.
    const sheet = report.contactSheet;
    expect(sheet.path).toBe("contact-sheet.png");
    expect(sheet.stills.map((s: { shotId: string }) => s.shotId)).toEqual(
      report.timeline.entries.map((e: { shotId: string }) => e.shotId),
    );
    for (const [i, still] of sheet.stills.entries()) {
      const entry = report.timeline.entries[i];
      expect(still.atSec).toBeCloseTo(entry.startSec + entry.durationSec / 2, 5);
      expect((await stat(join(dir, "out", still.path))).size).toBeGreaterThan(0);
    }
    const { probeSizePx } = await import("../src/ffmpeg");
    expect(await probeSizePx(join(dir, "out", sheet.path))).toEqual({ width: sheet.width, height: sheet.height });
    expect(report.tools.ffmpeg).not.toBe("");
    // Exact, relative, ordered concat selections. Whether a segment carries the
    // `.ext` suffix depends on capture timing (a clip only a few ms shorter than its
    // narration is extended), so the expectation follows the files actually produced.
    const segList = (await readFile(join(dir, "out", "seg", "list.txt"), "utf8")).split("\n");
    expect(segList).toHaveLength(2);
    const segFiles = await readdir(join(dir, "out", "seg"));
    segList.forEach((line, i) => {
      // An extended segment, when one was produced, is the one the concat selects.
      const expected = segFiles.includes(`seg_${i}.ext.mp4`) ? `seg_${i}.ext.mp4` : `seg_${i}.mp4`;
      expect(line).toBe(`file '${expected}'`);
    });
    expect(
      (await readFile(join(dir, "out", "audio", "list.txt"), "utf8"))
        .split("\n"),
    ).toEqual([
      "file 'pad_0.mp3'",
      "file 'pad_1.mp3'",
    ]);
    const claimMarker = await lstat(join(dir, "out", ".agent-demo-video-output-claim"));
    expect(claimMarker.isFile()).toBe(true);
    expect(claimMarker.size).toBe(0);
  }, 120_000);

  it("verifies a portrait shorts deliverable and tiles portrait stills", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-shorts-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), platform: "shorts" });
    await runPipeline(cfg);
    const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
    expect(report.deliverable.ok).toBe(true);
    expect(report.deliverable.probed).toMatchObject({ width: 1080, height: 1920, pixFmt: "yuv420p", frameRate: "30/1" });
    expect(report.contactSheet.tile).toEqual({ width: 480, height: 854 });
    const { probeSizePx } = await import("../src/ffmpeg");
    expect(await probeSizePx(join(dir, "out", report.contactSheet.path))).toEqual({
      width: report.contactSheet.width,
      height: report.contactSheet.height,
    });
  }, 120_000);

  it("verifies a 60fps render with sound design off, where one AAC frame exceeds one video frame", async () => {
    // Coverage for high-fps renders: an AAC frame (23.2ms) is longer than a 16.7ms
    // video frame, so the audio track can end more than a video frame early. Capture
    // timing decides where a given run lands, so the windows themselves are bound by
    // the checkDeliverable unit tests and the frame-exact mux by mux.smoke.
    const dir = await mkdtemp(join(tmpdir(), "pipe-60fps-nosd-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out: join(dir, "out"),
      resolution: { width: 1280, height: 720 },
      fps: 60,
      audio: { soundDesign: false },
    });
    await runPipeline(cfg);
    const report = JSON.parse(await readFile(join(dir, "out", "render-report.json"), "utf8"));
    expect(report.deliverable.ok).toBe(true);
    expect(report.deliverable.probed).toMatchObject({ frameRate: "60/1", avgFrameRate: "60/1", audioSampleRate: 44100 });
  }, 120_000);

  it("S3: enforces a DECLARED cap below the produced runtime, before it can ship", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-cap-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    // 1s is below anything this fixture can render, so the cap MUST reject.
    // Binds config.maxDurationSec to enforcement: reverting render.ts to a
    // hardcoded 300 previously kept every test green.
    const cfg = DemoConfigSchema.parse({ script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out: join(dir, "out"), resolution: { width: 1280, height: 720 }, maxDurationSec: 1 });
    await expect(runPipeline(cfg)).rejects.toThrow(/exceeds max 1s/);
  }, 120_000);

  it("S4: leaves no stale receipt beside a render that failed its cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-stale-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const out = join(dir, "out");
    const base = { script: scriptPath, dashboardBaseUrl: "http://localhost:3000", out, resolution: { width: 1280, height: 720 } };
    await runPipeline(DemoConfigSchema.parse(base));
    expect(JSON.parse(await readFile(join(out, "render-report.json"), "utf8")).render.parity.ok).toBe(true);
    expect((await stat(join(out, "contact-sheet.png"))).size).toBeGreaterThan(0);
    // Same out dir, now over-cap: final.mp4 is overwritten before parity throws,
    // so the previous run's passing receipt must not survive to describe it,
    // and neither may its contact sheet, which would picture a different render.
    await expect(runPipeline(DemoConfigSchema.parse({ ...base, maxDurationSec: 1 }))).rejects.toThrow();
    await expect(stat(join(out, "render-report.json"))).rejects.toThrow();
    await expect(stat(join(out, "contact-sheet.png"))).rejects.toThrow(/ENOENT/);
    await expect(stat(join(out, "contact-sheet"))).rejects.toThrow(/ENOENT/);
  }, 240_000);

  it("fresh output refuses an existing reviewed directory without changing its artifact pair", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-fresh-"));
    const out = join(dir, "reviewed");
    const finalBytes = Buffer.from("reviewed-final");
    const reportBytes = Buffer.from('{"reviewed":true}\n');
    await mkdir(out);
    await writeFile(join(out, "final.mp4"), finalBytes);
    await writeFile(join(out, "render-report.json"), reportBytes);
    const cfg = DemoConfigSchema.parse({
      script: join(dir, "missing.md"),
      dashboardBaseUrl: "http://localhost:3000",
      out,
      resolution: { width: 1280, height: 720 },
    });

    await expect(runPipeline(cfg, { requireFreshOut: true }))
      .rejects.toThrow(/fresh output.*already exists/i);

    expect(await readFile(join(out, "final.mp4"))).toEqual(finalBytes);
    expect(await readFile(join(out, "render-report.json"))).toEqual(reportBytes);
    expect((await readdir(out)).sort()).toEqual(["final.mp4", "render-report.json"]);
  });

  it("fresh output never writes into a replacement installed after the atomic name claim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipe-fresh-swap-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const tmpl = await readFile(resolve("tests/fixtures/demo.md"), "utf8");
    const scriptPath = join(dir, "demo.md");
    await writeFile(scriptPath, tmpl.replaceAll("FIXTURE_URL", fixture));
    const out = join(dir, "attempt");
    const displaced = join(dir, "claimed-attempt");
    const replacement = join(dir, "reviewed");
    const finalBytes = Buffer.from("reviewed-final");
    const reportBytes = Buffer.from('{"reviewed":true}\n');
    await mkdir(replacement);
    await writeFile(join(replacement, "final.mp4"), finalBytes);
    await writeFile(join(replacement, "render-report.json"), reportBytes);
    const cfg = DemoConfigSchema.parse({
      script: scriptPath,
      dashboardBaseUrl: "http://localhost:3000",
      out,
      resolution: { width: 1280, height: 720 },
      preflight: false,
    });

    const running = runPipeline(cfg, { requireFreshOut: true });
    for (let tries = 0; tries < 1_000; tries++) {
      try {
        // The public name is an O_EXCL regular-file claim for the whole
        // render. Swapping it immediately exercises the old mkdir-to-lstat
        // race window: no output directory is ever published before binding.
        if (!(await lstat(out)).isFile()) throw new Error("not claimed yet");
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 1));
      }
    }
    await rename(out, displaced);
    await symlink(replacement, out, "dir");

    await expect(running).rejects.toThrow(/fresh output pathname changed after claim/i);
    expect(await readFile(join(replacement, "final.mp4"))).toEqual(finalBytes);
    expect(await readFile(join(replacement, "render-report.json"))).toEqual(reportBytes);
    expect((await readdir(replacement)).sort()).toEqual(["final.mp4", "render-report.json"]);
    expect((await stat(displaced)).isFile()).toBe(true);
    const stageName = (await readdir(dir)).find((name) => name.startsWith(".attempt.stage-"));
    expect(stageName).toBeTruthy();
    expect((await stat(join(dir, stageName!, "final.mp4"))).size).toBeGreaterThan(0);
  }, 120_000);
});
