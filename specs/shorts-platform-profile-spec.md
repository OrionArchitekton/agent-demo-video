# Shorts (9:16) Platform Profile

## Intent

The pipeline renders a single landscape geometry today: one resolution knob is both
the browser capture viewport and the output canvas, and every finished video is
16:9. Shorts/TikTok/Reels distribution needs 9:16 1080x1920 cuts. A portrait canvas
cannot simply reuse the shared knob: desktop web apps must still be captured at a
16:9 desktop viewport, so portrait output requires decoupling capture geometry from
output geometry. The finished shorts look is the existing framed scene on a tall
canvas: the 16:9 capture floats as the rounded window, the backdrop gradient fills
the rest, captions and brand cards lay out on the canvas.

## Vocabulary

- **platform**: the named distribution preset ("landscape", "shorts"). Chosen over
  "profile", which in this codebase already means the persisted browser auth
  profile.
- **canvas**: the output frame geometry of the finished video (`resolution`).
- **capture viewport**: the browser viewport / screencast geometry shots are
  recorded at.
- **content size**: the geometry the render stage treats as the shape of incoming
  raw segments (equal to the capture viewport in a local pipeline).

## Scenarios (tracer-bullet slices)

1. **Platform preset.** A config declaring `platform: "shorts"` and nothing else
   about geometry renders a 1080x1920 canvas while capturing at a 1920x1080
   desktop viewport. A config with no platform, or `"landscape"`, behaves exactly
   as today (1920x1080 for both). An explicit `resolution` or an explicit capture
   viewport each override their preset value independently.
2. **Capture space vs canvas space.** Screencast size, recorded-video size, motion
   and zoom geometry, segment frame encoding, and preflight selector resolution all
   operate in capture-viewport space; segment compositing, brand cards, captions,
   and the final video operate in canvas space.
3. **Framed scene on a portrait canvas.** The rounded window keeps the content's
   aspect ratio, so a 16:9 capture on a 9:16 canvas shows no letterbox bars inside
   the window; the gradient backdrop fills the remaining canvas. When canvas and
   content share an aspect ratio (every existing config), framed output is
   argument-identical to pre-change behavior.
4. **Mixed-geometry framed clips fail closed.** When the window aspect is
   decoupled from the canvas (a shorts render), a framed clip whose own geometry
   does not match the declared content size is rejected loudly before
   compositing, naming the shot and the `fullBleed: true` escape hatch; padding
   bars inside the window is never shipped silently. A `fullBleed` shot bypasses
   framing and composites directly onto the canvas, so its source must match the
   canvas aspect within encoder-rounding slack; preflight and render both reject
   a mismatch rather than padding it. Inputs inspected at this seam must use
   square sample pixels and normalization pins the same first video stream that
   geometry probing validates. Landscape framed renders (content absent or
   canvas-aspect) keep today's pad-inside-window behavior unchanged.
5. **Remote-render parity.** A manifest built from a shorts config renders the same
   video remotely as locally: canvas and content size both travel. A manifest from
   an older build, which carries no content size, renders exactly as it does today.
6. **Single encode policy.** Every video-encode call site draws its CRF and preset
   from one named policy instead of six inline literals; current values are
   preserved (frame-sequence encode 18, all composite/normalize encodes 20).

## Constraints

- Backward compatibility is bit-level for existing configs: with no `platform`
  declared, every generated ffmpeg argument list is unchanged.
- No new dependencies; pure argument-builder modules stay pure.
- Explicit config always wins over a preset default.

## Acceptance criteria

- AC1: schema parse of `{platform: "shorts"}` yields canvas 1080x1920 and
  effective capture viewport 1920x1080; parse of `{}` yields 1920x1080 for both;
  explicit `resolution` / viewport values win over the preset.
- AC2: for canvas 1080x1920, content 1920x1080, window scale 0.86, the framed
  window is 928x522 (even dimensions), and mask, shadow, and composite geometry
  agree; for canvas 1920x1080 with 16:9 content the window is exactly today's
  1652x928.
- AC3: capture-space functions receive viewport geometry when it differs from the
  canvas.
- AC4: manifest build/load round-trips content size; a manifest without it falls
  back to canvas geometry.
- AC5: all six encode sites emit the centralized policy values; the full suite
  stays green with no argument changes for landscape configs.
- AC6: with a decoupled window (shorts), rendering a framed clip whose probed
  geometry mismatches the content size rejects with an error naming the shot and
  `fullBleed`; matching geometry (within encoder even-rounding slack) passes;
  canvas-aspect and content-absent configs never reject.
- AC7: an existing `fullBleed` clip whose display aspect differs from the output
  canvas is a blocking preflight finding before TTS and is independently
  rejected by the renderer before normalization; matching square-pixel aspects
  pass, while non-square sample aspect ratios fail closed at both seams.

## Test seams

- Config schema parse (the one `DemoConfigSchema.parse` seam) for scenario 1.
- Pure ffmpeg argument builders (framing, encode, cards) for scenarios 3 and 6.
- The capture-viewport derivation helper for scenario 2.
- Manifest build/load round-trip for scenario 5.
- The render stage invoked directly on prepared segment files (no capture) for
  scenario 4.
- The full preflight-to-pipeline seam for full-bleed source geometry.
