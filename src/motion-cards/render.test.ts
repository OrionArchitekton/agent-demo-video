import { describe, it, expect } from "vitest";
import { mkdtemp, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { checkMotionRequirements } from "./requirements";
import { titleCardHtml } from "./compose";
import { renderMotionCard, findRenderLogError } from "./render";
import { probeDeliverable } from "../ffmpeg";

describe("findRenderLogError", () => {
  it("returns the first line matching a hard-error pattern", () => {
    const log = "ok\nwarn: lint\nPAGEERROR boom\nnet::ERR_FAILED x\n";
    expect(findRenderLogError(log)).toBe("PAGEERROR boom");
    for (const bad of ["Unresolved font Foo", "net::ERR_X", "Failed to load resource: 404", "Continuing render despite errors"]) {
      expect(findRenderLogError(`fine\n${bad}\n`)).toBe(bad);
    }
    expect(findRenderLogError("Lint: 0 error(s), 2 warning(s)\n  Continuing render despite lint issues. Use --strict to block errors.\n")).toBeNull();
    expect(findRenderLogError("all good\nlint warning\n")).toBeNull();
  });
});

describe("renderMotionCard log scan", () => {
  it("fails when the CLI exits 0 but its log reports a page error", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "mc-out-")), "o.mp4");
    const fake = resolve("tests/fixtures/voice/fake-hyperframes.mjs");
    await expect(renderMotionCard(fake, "<html></html>", out, "logscan", 30)).rejects.toThrowError(/^motion card \(logscan\): PAGEERROR boom$/);
    await expect(access(out)).rejects.toThrow();
  });

  it("runs HyperFrames with telemetry, update checks and auto-install off, and no desktop display", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "mc-env-")), "o.mp4");
    const fake = resolve("tests/fixtures/voice/fake-hyperframes.mjs");
    const prev = process.env.DISPLAY;
    process.env.DISPLAY = ":99";
    try {
      await expect(renderMotionCard(fake, "<html></html>", out, "env", 30)).rejects.toThrowError(/PAGEERROR boom/);
    } finally {
      if (prev === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = prev;
    }
    const env = JSON.parse(await readFile(`${out}.env.json`, "utf8"));
    expect(env).toEqual({
      HYPERFRAMES_NO_TELEMETRY: "1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      HYPERFRAMES_NO_AUTO_INSTALL: "1",
      DO_NOT_TRACK: "1",
      DISPLAY: null,
    });
  });
});

const req = checkMotionRequirements();
if (!req.ok) console.warn(`render integration skipped: ${req.problems.join("; ")}`);

describe.skipIf(!req.ok)("renderMotionCard (real HyperFrames)", () => {
  it("renders a 640x360 30fps 2s title card whose first frame shows the hook", { timeout: 300_000 }, async () => {
    if (!req.ok) return;
    const dir = await mkdtemp(join(tmpdir(), "mc-it-"));
    const out = join(dir, "card.mp4");
    const html = titleCardHtml({
      width: 640, height: 360, fps: 30, durationSec: 2, font: "Arial",
      backdropTop: "#101418", backdropBottom: "#1d2733", accent: "#3fb950",
      title: "Demo", hook: "Stop pasting secrets",
    });
    const t0 = Date.now();
    let log = "";
    await renderMotionCard(req.hyperframesBin, html, out, "title", 300, (t) => { log = t; });
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toMatch(/from Google Fonts/);
    console.log(`integration render took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const p = await probeDeliverable(out);
    expect(p.width).toBe(640);
    expect(p.height).toBe(360);
    expect(Number(p.frameRate!.split("/")[0]) / Number(p.frameRate!.split("/")[1] ?? 1)).toBe(30);
    expect(Math.abs((p.durationSec ?? 0) - 2)).toBeLessThanOrEqual(0.1);
    // frame 0, central band (where the hook sits), 8-bit gray
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-vf", "select=eq(n\\,0),crop=640:180:0:90,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 64 * 1024 * 1024 });
    expect(raw.length).toBe(640 * 180);
    let bright = 0;
    for (const v of raw) if (v > 200) bright++;
    expect(bright / raw.length).toBeGreaterThanOrEqual(0.01);
  });

  it("rejects a broken composition naming the card", { timeout: 300_000 }, async () => {
    if (!req.ok) return;
    const out = join(await mkdtemp(join(tmpdir(), "mc-bad-")), "bad.mp4");
    await expect(renderMotionCard(req.hyperframesBin, "<html></html>", out, "broken")).rejects.toThrowError(/motion card \(broken\): exited 1:[\s\S]*zero duration/);
    await expect(access(out)).rejects.toThrow();
  });
});
