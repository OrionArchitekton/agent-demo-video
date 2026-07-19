import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
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
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000" });
    const shot = { id: "p1", target: "prebaked" as const, clip: "clips/none.mp4", narration: "demo", actions: [] };
    await captureShot(shot, { shotId: "p1", startSec: 0, durationSec: 1 }, cfg, dir);
    expect(existsSync(join(dir, "events_p1.json"))).toBe(false);
  });
});
