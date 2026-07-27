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
4. **Remote-render parity.** A manifest built from a shorts config renders the same
   video remotely as locally: canvas and content size both travel. A manifest from
   an older build, which carries no content size, renders exactly as it does today.
5. **Single encode policy.** Every video-encode call site draws its CRF and preset
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

## Test seams

- Config schema parse (the one `DemoConfigSchema.parse` seam) for scenario 1.
- Pure ffmpeg argument builders (framing, encode, cards) for scenarios 3 and 5.
- The capture-viewport derivation helper for scenario 2.
- Manifest build/load round-trip for scenario 4.
