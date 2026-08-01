import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg, probeSizePx } from "../src/ffmpeg";
import { renderVideo, type RenderInputs } from "../src/render";

/**
 * Shorts renders decouple the framed window's aspect (capture viewport) from
 * the canvas. A framed prebaked clip with its own geometry would be padded
 * with bars INSIDE the window, silently defeating the preset's no-bars
 * contract, so the render must reject it loudly and point at the fullBleed
 * escape hatch. This exercises the real seam: ffprobe geometry -> guard ->
 * before any compositing.
 */
describe("renderVideo framed-aspect guard (shorts)", () => {
  it("rejects a framed portrait clip on a decoupled shorts canvas, naming the shot and fullBleed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aspect-guard-"));
    const portrait = join(dir, "portrait.mp4");
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=540x960:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", portrait]);

    const inputs: RenderInputs = {
      rawSegments: [portrait],
      tts: [{ shotId: "intro", audioPath: join(dir, "unused.mp3"), durationSec: 0.4, alignment: { chars: [], startSec: [], endSec: [] } }],
      segmentKinds: ["shot"],
      contentSize: { width: 1920, height: 1080 },
      config: {
        audio: { soundDesign: false, bedDb: -28, ticks: true, sweeps: true },
        resolution: { width: 1080, height: 1920 },
        fps: 30,
        theme: { captionFont: "Liberation Sans", captionSize: 24, cursor: true, captionBox: true, captionMarginV: 20, captions: "block" as const, captionAccent: "#3fb950", fadeInMs: 250, frame: { enabled: true, scale: 0.86, radius: 24, backdropTop: "#101418", backdropBottom: "#1d2733", shadow: true }, annotations: { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const } },
        out: join(dir, "out"),
        maxDurationSec: 300,
      },
    };
    await expect(renderVideo(inputs)).rejects.toThrow(/intro.*fullBleed|fullBleed.*intro/s);
  }, 60_000);

  it("rejects a landscape fullBleed clip on a portrait canvas before normalization", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fullbleed-aspect-guard-"));
    const landscape = join(dir, "landscape.mp4");
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", landscape]);

    const inputs: RenderInputs = {
      rawSegments: [landscape],
      tts: [{ shotId: "portrait-proof", audioPath: join(dir, "unused.mp3"), durationSec: 0.4, alignment: { chars: [], startSec: [], endSec: [] } }],
      segmentKinds: ["card"],
      config: {
        audio: { soundDesign: false, bedDb: -28, ticks: true, sweeps: true },
        resolution: { width: 360, height: 640 },
        fps: 30,
        theme: { captionFont: "Liberation Sans", captionSize: 24, cursor: true, captionBox: true, captionMarginV: 20, captions: "block" as const, captionAccent: "#3fb950", fadeInMs: 250, frame: { enabled: false, scale: 0.86, radius: 24, backdropTop: "#101418", backdropBottom: "#1d2733", shadow: false }, annotations: { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const } },
        out: join(dir, "out"),
        maxDurationSec: 300,
      },
    };

    await expect(renderVideo(inputs)).rejects.toThrow(/portrait-proof.*320x180.*360x640/s);
  }, 60_000);
});

/**
 * Phone footage is routinely landscape-CODED with a 90 degree display matrix;
 * ffmpeg autorotates it to portrait during transcoding. The probe must report
 * DISPLAY geometry, or such a clip passes the guard as 16:9 and ships bars.
 */
describe("probeSizePx display geometry", () => {
  it("reports coded size for an unrotated clip and swaps axes for a 90-degree display matrix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "probe-size-"));
    const plain = join(dir, "plain.mp4");
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", plain]);
    expect(await probeSizePx(plain)).toEqual({ width: 320, height: 180 });

    const rotated = join(dir, "rot90.mp4");
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-display_rotation", "90", "-i", plain, "-c", "copy", rotated]);
    expect(await probeSizePx(rotated)).toEqual({ width: 180, height: 320 });
  }, 60_000);

  it("rejects display-equivalent anamorphic input before normalization can distort it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "probe-sar-"));
    const sar = join(dir, "sar.mp4");
    await ffmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      // Coded 90x320 with SAR 2:1 displays as portrait 180x320. A display-only
      // aspect probe would approve it, but normalize currently operates on the
      // coded 9:32 shape and would add bars before preserving the non-square SAR.
      "-f", "lavfi", "-i", "color=c=green:s=90x320:d=0.2",
      "-vf", "setsar=2/1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", sar,
    ]);

    await expect(probeSizePx(sar)).rejects.toThrow(/non-square sample aspect ratio 2:1.*square pixels/s);
  }, 60_000);

  it("rejects anamorphic fullBleed input at the direct render seam", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-sar-guard-"));
    const sar = join(dir, "portrait-sar.mp4");
    await ffmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=green:s=90x320:d=0.4",
      "-vf", "setsar=2/1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", sar,
    ]);
    const inputs: RenderInputs = {
      rawSegments: [sar],
      tts: [{ shotId: "sar-proof", audioPath: join(dir, "unused.mp3"), durationSec: 0.4, alignment: { chars: [], startSec: [], endSec: [] } }],
      segmentKinds: ["card"],
      config: {
        audio: { soundDesign: false, bedDb: -28, ticks: true, sweeps: true },
        resolution: { width: 360, height: 640 },
        fps: 30,
        theme: { captionFont: "Liberation Sans", captionSize: 24, cursor: true, captionBox: true, captionMarginV: 20, captions: "block" as const, captionAccent: "#3fb950", fadeInMs: 250, frame: { enabled: false, scale: 0.86, radius: 24, backdropTop: "#101418", backdropBottom: "#1d2733", shadow: false }, annotations: { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const } },
        out: join(dir, "out"),
        maxDurationSec: 300,
      },
    };

    await expect(renderVideo(inputs)).rejects.toThrow(/non-square sample aspect ratio 2:1.*square pixels/s);
  }, 60_000);
});
