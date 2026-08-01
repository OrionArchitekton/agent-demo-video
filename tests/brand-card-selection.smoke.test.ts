import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "../src/pipeline";
import { DemoConfigSchema } from "../src/types";

function sh(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

async function renderTimeline(brand: Record<string, unknown>): Promise<string[]> {
  vi.stubEnv("FAKE_TTS", "1");
  try {
    const dir = await mkdtemp(join(tmpdir(), "brand-card-selection-"));
    const clip = join(dir, "proof.mp4");
    await sh("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", clip,
    ]);
    const script = join(dir, "DEMO_SCRIPT.md");
    await writeFile(
      script,
      [
        "### SHOT proof",
        "- target: prebaked",
        `- clip: ${clip}`,
        "- fullBleed: true",
        "- narration: Proof first.",
        "",
      ].join("\n"),
    );
    const config = DemoConfigSchema.parse({
      script,
      dashboardBaseUrl: "http://localhost",
      out: join(dir, "out"),
      resolution: { width: 640, height: 360 },
      audio: { soundDesign: false },
      brand,
    });

    const result = await runPipeline(config);
    return result.report.timeline.entries.map((entry) => entry.shotId);
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("independent brand-card selection", () => {
  it("cold-opens on the first proof shot while retaining only the closing card", async () => {
    expect(await renderTimeline({
      title: "Reviewed disclosure",
      cards: true,
      titleCard: false,
      endCard: true,
      endSec: 0.5,
    })).toEqual(["proof", "__card-end"]);
  }, 120_000);

  it("can retain only the opening card", async () => {
    expect(await renderTimeline({
      title: "Reviewed disclosure",
      cards: true,
      titleCard: true,
      endCard: false,
      titleSec: 0.5,
    })).toEqual(["__card-title", "proof"]);
  }, 120_000);

  it("keeps the legacy cards-only path rendering both cards", async () => {
    expect(await renderTimeline({
      title: "Reviewed disclosure",
      cards: true,
      titleSec: 0.5,
      endSec: 0.5,
    })).toEqual(["__card-title", "proof", "__card-end"]);
  }, 120_000);
});
