import { describe, it, expect, beforeAll } from "vitest";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureShot } from "../src/capture";
import { DemoConfigSchema } from "../src/types";

describe("captureShot (smoke)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("records an h264 mp4 segment plus an events artifact driving the fixture page (screencast engine)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cap-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000", resolution: { width: 1280, height: 720 } });
    const shot = { id: "s1", target: "dashboard" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: fixture },
      { kind: "click" as const, selector: "#bootstrap", label: "Bootstrap" },
      { kind: "click" as const, selector: "#degraded" },
    ] };
    const seg = await captureShot(shot, { shotId: "s1", startSec: 0, durationSec: 2 }, cfg, dir);
    expect(seg.endsWith(".mp4")).toBe(true);
    expect((await stat(seg)).size).toBeGreaterThan(0);
    expect((await stat(join(dir, "events_s1.json"))).size).toBeGreaterThan(0);
  }, 60_000);
});

describe("stale events artifact (pipeline finding)", () => {
  it("clears a previous run's events file before capture so obsolete click ticks never leak", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cap-stale-"));
    await writeFile(join(dir, "events_p1.json"), JSON.stringify([{ kind: "click", tMs: 500 }]));
    // The clip must now actually EXIST: prebaked resolution used to return the
    // declared path verbatim, so this test previously passed against
    // "clips/none.mp4", a file that was never there (issue #14).
    await writeFile(join(dir, "clip.mp4"), "stand-in for an mp4");
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000", configDir: dir, clipsDir: "." });
    const shot = { id: "p1", target: "prebaked" as const, clip: "clip.mp4", narration: "demo", actions: [] };
    await captureShot(shot, { shotId: "p1", startSec: 0, durationSec: 1 }, cfg, dir);
    expect(existsSync(join(dir, "events_p1.json"))).toBe(false);
  });
});

describe("highlight selector diagnostics (issue #13)", () => {
  // The sibling `click` action already throws a shot-scoped message. `highlight`
  // was the only selector-bearing action without one: an ambiguous selector
  // surfaced as a raw Playwright strict-mode violation and a zero-match as a
  // bare "Timeout 30000ms exceeded" — neither naming the shot, the selector, or
  // even the fact that a highlight was involved.
  it("names the shot, the selector, and the real match count when a highlight is not unique", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cap-amb-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000", resolution: { width: 1280, height: 720 } });
    const shot = { id: "amb", target: "dashboard" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: fixture },
      { kind: "highlight" as const, selector: "button" },
    ] };
    await expect(captureShot(shot, { shotId: "amb", startSec: 0, durationSec: 1 }, cfg, dir))
      .rejects.toThrow(/shot amb: highlight selector "button" resolved to 2 elements/);
  }, 60_000);

  // Regression guard for the fix above. Diagnosing the failure must not cost the
  // WAITING: the locator still auto-waits, and only the error message changed.
  // Counting matches up front instead would be faster and wrong — an element
  // that hydrates in after `load` would start failing a script that works today.
  it("still waits for an element that only appears after load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cap-late-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/late-element.html")).href;
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000", resolution: { width: 1280, height: 720 } });
    const shot = { id: "late", target: "dashboard" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: fixture },
      { kind: "highlight" as const, selector: "#late" },
    ] };
    const seg = await captureShot(shot, { shotId: "late", startSec: 0, durationSec: 2 }, cfg, dir);
    expect(seg.endsWith(".mp4")).toBe(true);
  }, 60_000);
});

describe("prebaked clip resolution (issue #14)", () => {
  /** A config dir holding clips/prebaked/<name>, plus a scratch out dir. */
  async function clipFixture(name: string): Promise<{ cfgDir: string; outDir: string; clipPath: string }> {
    const cfgDir = await mkdtemp(join(tmpdir(), "clipcfg-"));
    const outDir = await mkdtemp(join(tmpdir(), "clipout-"));
    const clipPath = join(cfgDir, "clips", "prebaked", name);
    await mkdir(join(cfgDir, "clips", "prebaked"), { recursive: true });
    await writeFile(clipPath, "stand-in for an mp4");
    return { cfgDir, outDir, clipPath };
  }

  // clipsDir was declared in the schema, defaulted, documented in the README at
  // :228 and :245 — and read by nothing. `shot.clip` came back verbatim, so a
  // bare filename resolved against the PROCESS CWD and a user who followed the
  // README got a file-not-found.
  it("resolves a bare clip filename inside clipsDir, against the config dir not the CWD", async () => {
    const { cfgDir, outDir, clipPath } = await clipFixture("uipath.mp4");
    const cfg = DemoConfigSchema.parse({
      script: "x", dashboardBaseUrl: "http://localhost:3000", configDir: cfgDir,
    });
    const shot = { id: "pb", target: "prebaked" as const, clip: "uipath.mp4", narration: "n", actions: [] };
    const got = await captureShot(shot, { shotId: "pb", startSec: 0, durationSec: 1 }, cfg, outDir);
    expect(got).toBe(clipPath);
  });

  // No silent fallback to some other path: say which path was tried.
  it("fails naming the resolved path when a prebaked clip is missing", async () => {
    const { cfgDir, outDir } = await clipFixture("present.mp4");
    const cfg = DemoConfigSchema.parse({
      script: "x", dashboardBaseUrl: "http://localhost:3000", configDir: cfgDir,
    });
    const shot = { id: "pb", target: "prebaked" as const, clip: "absent.mp4", narration: "n", actions: [] };
    await expect(captureShot(shot, { shotId: "pb", startSec: 0, durationSec: 1 }, cfg, outDir))
      .rejects.toThrow(/clips[/\\]prebaked[/\\]absent\.mp4/);
  });
});
