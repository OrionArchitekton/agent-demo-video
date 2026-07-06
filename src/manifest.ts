import { basename, join } from "node:path";
import type { Alignment } from "./types";
import type { RenderInputs, RenderConfig } from "./render";

/**
 * The portable, host-independent form of RenderInputs. File references are
 * reduced to basenames (the actual bytes travel alongside under seg/ and
 * audio/); all render-affecting metadata (durations, caption alignment,
 * resolution/fps/theme) travels inline. `out` is deliberately omitted: it is
 * reconstructed relative to the loading host's base dir.
 */
export interface RenderManifest {
  segments: string[];
  audio: { file: string; durationSec: number; alignment: Alignment; shotId: string }[];
  config: Omit<RenderConfig, "out">;
}

export function buildManifest(inputs: RenderInputs): RenderManifest {
  return {
    segments: inputs.rawSegments.map((p) => basename(p)),
    audio: inputs.tts.map((t) => ({
      file: basename(t.audioPath),
      durationSec: t.durationSec,
      alignment: t.alignment,
      shotId: t.shotId,
    })),
    config: {
      resolution: inputs.config.resolution,
      fps: inputs.config.fps,
      theme: inputs.config.theme,
    },
  };
}

export function loadManifest(manifest: RenderManifest, baseDir: string): RenderInputs {
  return {
    rawSegments: manifest.segments.map((f) => join(baseDir, "seg", f)),
    tts: manifest.audio.map((a) => ({
      shotId: a.shotId,
      audioPath: join(baseDir, "audio", a.file),
      durationSec: a.durationSec,
      alignment: a.alignment,
    })),
    config: {
      resolution: manifest.config.resolution,
      fps: manifest.config.fps,
      theme: manifest.config.theme,
      out: join(baseDir, "out"),
    },
  };
}
