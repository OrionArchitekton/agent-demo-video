import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureShot } from "../src/capture";
import { DemoConfigSchema } from "../src/types";

describe("captureShot (smoke)", () => {
  beforeAll(() => { process.env.FAKE_TTS = "1"; });
  it("records a webm driving the fixture page", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cap-"));
    const fixture = pathToFileURL(resolve("tests/fixtures/page.html")).href;
    const cfg = DemoConfigSchema.parse({ script: "x", dashboardBaseUrl: "http://localhost:3000", resolution: { width: 1280, height: 720 } });
    const shot = { id: "s1", target: "dashboard" as const, narration: "demo", actions: [
      { kind: "goto" as const, url: fixture },
      { kind: "click" as const, selector: "#bootstrap", label: "Bootstrap" },
      { kind: "click" as const, selector: "#degraded" },
    ] };
    const webm = await captureShot(shot, { shotId: "s1", startSec: 0, durationSec: 2 }, cfg, dir);
    expect(webm.endsWith(".webm")).toBe(true);
    expect((await stat(webm)).size).toBeGreaterThan(0);
  }, 60_000);
});
