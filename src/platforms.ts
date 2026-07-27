/**
 * platforms.ts — named distribution presets (specs/shorts-platform-profile-spec.md).
 *
 * A platform decouples the OUTPUT CANVAS (config.resolution: the finished
 * video's geometry) from the CAPTURE VIEWPORT (the browser geometry shots are
 * recorded at). "landscape" is the historical coupled behavior: the viewport
 * follows the canvas. "shorts" renders a 9:16 1080x1920 canvas while still
 * capturing web apps at a 16:9 desktop viewport; the framed scene centers the
 * capture window on the tall canvas.
 *
 * Not the browser auth profile — that is profile.ts.
 */

export interface Size {
  width: number;
  height: number;
}

/** captureViewport null = "follow the resolved canvas" (the coupled default). */
export const PLATFORMS: Record<"landscape" | "shorts", { resolution: Size; captureViewport: Size | null }> = {
  landscape: { resolution: { width: 1920, height: 1080 }, captureViewport: null },
  shorts: { resolution: { width: 1080, height: 1920 }, captureViewport: { width: 1920, height: 1080 } },
};

export type PlatformName = keyof typeof PLATFORMS;

/**
 * Effective browser/capture geometry for a resolved config: an explicit
 * `capture.viewport` wins, then the platform preset's viewport; a platform
 * without one (landscape) follows the canvas, which is exactly the historical
 * single-knob behavior.
 */
export function captureViewport(cfg: {
  platform: PlatformName;
  resolution: Size;
  capture: { viewport?: Size };
}): Size {
  return cfg.capture.viewport ?? PLATFORMS[cfg.platform].captureViewport ?? cfg.resolution;
}
