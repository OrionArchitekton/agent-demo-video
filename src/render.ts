import type { DemoConfig, TtsResult } from "./types";

/** The render-affecting subset of the demo config (no capture/tts/auth fields). */
export type RenderConfig = Pick<DemoConfig, "resolution" | "fps" | "theme" | "out">;

/**
 * Everything the render stage consumes, independent of how it was produced.
 * `rawSegments` are the captured (unnormalized) video segments; `tts` carries
 * the per-shot audio path, measured duration, and caption alignment.
 */
export interface RenderInputs {
  rawSegments: string[];
  tts: TtsResult[];
  config: RenderConfig;
}
