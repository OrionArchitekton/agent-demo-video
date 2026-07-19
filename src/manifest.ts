import { extname, join } from "node:path";
import type { Alignment } from "./types";
import type { RenderInputs, RenderConfig } from "./render";

/**
 * The portable, host-independent form of RenderInputs. File references are
 * renamed to INDEX-based basenames (seg_<i>.<ext> / aud_<i>.<ext>) so two
 * distinct source files that happen to share a basename cannot collide when
 * staged flat on the render host; the actual bytes travel alongside under seg/
 * and audio/. All render-affecting metadata (durations, caption alignment,
 * resolution/fps/theme) travels inline. `out` is deliberately omitted: it is
 * reconstructed relative to the loading host's base dir.
 */
export interface RenderManifest {
  segments: string[];
  segmentKinds?: ("shot" | "card")[];
  clickOffsets?: number[][];
  audio: { file: string; durationSec: number; alignment: Alignment; shotId: string }[];
  config: Omit<RenderConfig, "out">;
}

export function buildManifest(inputs: RenderInputs): RenderManifest {
  return {
    segments: inputs.rawSegments.map((p, i) => `seg_${i}${extname(p)}`),
    ...(inputs.segmentKinds ? { segmentKinds: inputs.segmentKinds } : {}),
    ...(inputs.clickOffsets ? { clickOffsets: inputs.clickOffsets } : {}),
    audio: inputs.tts.map((t, i) => ({
      file: `aud_${i}${extname(t.audioPath)}`,
      durationSec: t.durationSec,
      alignment: t.alignment,
      shotId: t.shotId,
    })),
    config: {
      resolution: inputs.config.resolution,
      fps: inputs.config.fps,
      theme: inputs.config.theme,
      audio: inputs.config.audio,
    },
  };
}

export function loadManifest(manifest: RenderManifest, baseDir: string): RenderInputs {
  return {
    rawSegments: manifest.segments.map((f) => join(baseDir, "seg", f)),
    ...(manifest.segmentKinds ? { segmentKinds: manifest.segmentKinds } : {}),
    ...(manifest.clickOffsets ? { clickOffsets: manifest.clickOffsets } : {}),
    tts: manifest.audio.map((a) => ({
      shotId: a.shotId,
      audioPath: join(baseDir, "audio", a.file),
      durationSec: a.durationSec,
      alignment: a.alignment,
    })),
    config: {
      resolution: manifest.config.resolution,
      fps: manifest.config.fps,
      // Pre-polish manifests carry no audio block and a theme without the
      // frame/captions knobs: default them to legacy-equivalent behavior.
      theme: {
        ...manifest.config.theme,
        captions: manifest.config.theme.captions ?? ("block" as const),
        captionAccent: manifest.config.theme.captionAccent ?? "#3fb950",
        fadeInMs: manifest.config.theme.fadeInMs ?? 0,
        frame: manifest.config.theme.frame ?? { enabled: false, scale: 0.86, radius: 24, backdropTop: "#101418", backdropBottom: "#1d2733", shadow: true },
        annotations: manifest.config.theme.annotations ?? { enabled: true, durationMs: 500, fontSize: 24, position: "top-right" as const },
      },
      audio: manifest.config.audio ?? { soundDesign: false, bedDb: -28, ticks: true, sweeps: true },
      out: join(baseDir, "out"),
    },
  };
}
