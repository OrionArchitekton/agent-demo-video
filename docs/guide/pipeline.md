# How it works

```
DEMO_SCRIPT.md
      │
      ▼
1. parseScript: parse shots + actions from Markdown
2. TTS (ElevenLabs): synthShot per shot → audio + per-char alignment
3. Playwright capture (captureShot per shot): headless Chromium screencast
   (CDP JPEG frames + per-frame timestamps), native animated cursor +
   action annotations + chapter cards, zoom-on-action camera motion,
   dwell = narration duration
4. ffmpeg normalize: encode frames straight to H.264 (per-frame durations
   from capture timestamps), uniform res/fps, soft fade-in between segments
5. build timeline: measure probe durations → assemble startSec offsets
6. captions.srt: per-char alignment → word-timed SRT
7. pad audio: silence-pad each audio track to match video segment
8. concat + mux: concat video, concat audio, mux together
9. burn captions: subtitles filter burned into final.mp4
10. parity verify: shotCount / videoSegments / audioSec / videoSec / maxSec
11. deliverable check (ffprobe on the delivered final.mp4): one H.264 yuv420p
    video stream at the configured size and fps, square pixels, one AAC audio
    stream, frame-exact video track
12. contact sheet: one still per segment at its midpoint, tiled into
    contact-sheet.png beside final.mp4
```

## Deliverable verification

After every successful render, local or remote, the pipeline checks the video the
operator actually receives. It first binds the renderer's measured timeline to the shots
this run rendered (same shots, same order, contiguous, total equal to the last shot's end),
since a remote host reports that timeline. The deliverable contract is read from `final.mp4` with
ffprobe, never from the config or a render host's own report: exactly one H.264
`yuv420p` video stream at the configured width, height, and fps with square pixels and
no display rotation,
exactly one AAC audio stream, a constant frame rate (the average rate must match too),
a frame-exact video track, an audio track that ends within an audio frame or two of the
measured timeline (AAC encodes whole frames), and a container within one video or audio
frame of it. Any mismatch fails the run with every mismatched property named, before
`render-report.json` is written. The final mux pads the audio so it never drops trailing
video frames.

The pipeline then writes `out/contact-sheet.png`: one still per segment (title and end cards
included), taken at the
midpoint of its measured timeline entry (clamped to a frame inside the shot), tiled in
timeline order, four across for landscape and six across for portrait. The individual
stills stay in `out/contact-sheet/`; both are rebuilt from scratch on every run, and a
rerun into the same `out` removes the previous sheet up front, so a failed attempt never
leaves another render's sheet behind. A still that yields no frame fails the run.
`render-report.json` records `deliverable` (the
probed values, `ok`, and any problems) and `contactSheet` (the sheet path and grid, and
each still's shot id, time, and path). The sheet makes a whole render reviewable at a
glance; it does not judge whether the render is good.

## Production polish

Renders are produced pieces by default: the capture floats as a rounded,
shadowed window on a gradient backdrop (`theme.frame`), a synthesized ambient
bed ducks under the narration with soft click ticks and boundary sweeps
(`audio.*`; `audio.musicPath` swaps in your own track, local renders only),
captions pop word-by-word in sync with speech (`theme.captions: "wordpop"`,
accent via `theme.captionAccent`), a living camera keeps a gentle base zoom and
travels between action targets (`motion.livingCamera`), and optional brand
cards open and close the video (`brand: { title, subtitle, url, accent }`).
Narration defaults to ElevenLabs' quality tier (`eleven_multilingual_v2`).
Every knob has a legacy off-switch. Requires ffmpeg >= 5.1 (amix normalize,
gradients, zoompan input-time are all in use).

## Capture engines

The default engine is **screencast**: CDP JPEG frames are captured with their
timestamps and assembled into H.264 directly, so text stays crisp (no VP8
intermediate) and the frame timeline is deterministic (each frame's display
time comes from its capture timestamp, which keeps narration and captions in
sync by construction). It also enables the native liveliness features:

- **Animated cursor + action annotations** (`theme.annotations`, on by
  default): a pointer travels from action to action, interacted elements are
  visibly annotated, and `chapter` actions render as centered title cards.
- **Zoom-on-action** (`motion.zoomOnAction`, on by default): the camera eases
  toward each clicked/typed/highlighted element and back out, driven by the
  interaction event timeline persisted as `events_<shot>.json`.
- **Soft transitions** (`theme.fadeInMs`, default 250): each segment after the
  first opens with a brief fade-in instead of a hard cut.
- **Smooth scrolling**: `action: scroll selector="#target"` (or `y=800`)
  glides instead of jumping.

Set `capture.engine: "recordvideo"` to fall back to the legacy Playwright
recordVideo path (VP8 WebM intermediate, injected overlay cursor). A
screencast failure is an error, never a silent engine fallback.

A hermetic end-to-end check lives at `demos/smoke/` (a local `file://` fixture
page): `FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json`.

Third-party / auth-walled surfaces have two options: drive them **live** behind a real login with `target: live` (a saved Playwright profile; see [Authenticated SaaS capture](authenticated-capture.md)), or, for surfaces you cannot or prefer not to automate, `target: prebaked`: supply a pre-captured clip file and the pipeline splices it in at the right point.

Back to the [README](../../README.md).
