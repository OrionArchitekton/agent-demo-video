import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildManifest, loadManifest } from "../src/manifest";
import type { RenderInputs } from "../src/render";

/**
 * A render manifest is the portable, host-independent description of everything
 * the render stage needs. Building then loading it under a new base directory
 * must preserve all render-affecting metadata (caption alignment, durations,
 * resolution/fps/theme) exactly, while relocating file references to the new
 * host's directory. Metadata drift here silently changes the rendered video.
 */
function sampleInputs(): RenderInputs {
  return {
    rawSegments: ["/local/work/seg/raw_0.webm", "/local/work/seg/raw_1.webm"],
    tts: [
      {
        shotId: "one",
        audioPath: "/local/work/audio/one.mp3",
        durationSec: 3.42,
        alignment: { chars: ["H", "i"], startSec: [0, 0.1], endSec: [0.1, 0.2] },
      },
      {
        shotId: "two",
        audioPath: "/local/work/audio/two.mp3",
        durationSec: 2.28,
        alignment: { chars: ["Y", "o"], startSec: [0, 0.2], endSec: [0.2, 0.4] },
      },
    ],
    config: {
      audio: { soundDesign: false, bedDb: -28, ticks: true, sweeps: true },
      resolution: { width: 1280, height: 720 },
      fps: 30,
      theme: { captionFont: "Liberation Sans", captionSize: 24, cursor: true, captionBox: true, captionMarginV: 20, captions: "block" as const, captionAccent: "#3fb950", fadeInMs: 250, frame: { enabled: false, scale: 0.86, radius: 24, backdropTop: "#101418", backdropBottom: "#1d2733", shadow: true }, annotations: { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const } },
      out: "/local/work/out",
    },
  };
}

describe("render manifest", () => {
  it("round-trips render metadata exactly and rebases file paths under a new base dir", () => {
    const inputs = sampleInputs();
    const base = "/remote/render-abc";

    const loaded = loadManifest(buildManifest(inputs), base);

    // metadata preserved exactly (any drift changes the rendered output)
    expect(loaded.tts.map((t) => t.durationSec)).toEqual([3.42, 2.28]);
    expect(loaded.tts.map((t) => t.alignment)).toEqual(inputs.tts.map((t) => t.alignment));
    expect(loaded.tts.map((t) => t.shotId)).toEqual(["one", "two"]);
    expect(loaded.config.resolution).toEqual({ width: 1280, height: 720 });
    expect(loaded.config.fps).toBe(30);
    expect(loaded.config.theme).toEqual(inputs.config.theme);

    // file references relocated under the new base dir with index-based names
    expect(loaded.rawSegments).toEqual([
      join(base, "seg", "seg_0.webm"),
      join(base, "seg", "seg_1.webm"),
    ]);
    expect(loaded.tts.map((t) => t.audioPath)).toEqual([
      join(base, "audio", "aud_0.mp3"),
      join(base, "audio", "aud_1.mp3"),
    ]);
    expect(loaded.config.out).toBe(join(base, "out"));
  });

  it("serializes to JSON that carries no absolute local paths (host-independent)", () => {
    const json = JSON.stringify(buildManifest(sampleInputs()));
    expect(json).not.toContain("/local/work");
  });

  it("keeps two source files with the same basename distinct (no remote collision)", () => {
    const inputs: RenderInputs = {
      rawSegments: ["/clips/a/intro.mp4", "/clips/b/intro.mp4"],
      tts: [
        { shotId: "a", audioPath: "/x/v.mp3", durationSec: 1, alignment: { chars: [], startSec: [], endSec: [] } },
        { shotId: "b", audioPath: "/y/v.mp3", durationSec: 1, alignment: { chars: [], startSec: [], endSec: [] } },
      ],
      config: {
        audio: { soundDesign: false, bedDb: -28, ticks: true, sweeps: true },
        resolution: { width: 320, height: 240 },
        fps: 15,
        theme: { captionFont: "Liberation Sans", captionSize: 24, cursor: true, captionBox: true, captionMarginV: 20, captions: "block" as const, captionAccent: "#3fb950", fadeInMs: 250, frame: { enabled: false, scale: 0.86, radius: 24, backdropTop: "#101418", backdropBottom: "#1d2733", shadow: true }, annotations: { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const } },
        out: "/o",
      },
    };
    const m = buildManifest(inputs);
    expect(new Set(m.segments).size).toBe(2);
    expect(new Set(m.audio.map((a) => a.file)).size).toBe(2);
    const loaded = loadManifest(m, "/base");
    expect(new Set(loaded.rawSegments).size).toBe(2);
    expect(new Set(loaded.tts.map((t) => t.audioPath)).size).toBe(2);
  });
});
