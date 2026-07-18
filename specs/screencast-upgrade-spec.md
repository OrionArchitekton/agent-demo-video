# Screencast Capture Upgrade — Spec

Status: active (implements the 2026-07-18 demo-video-pipeline-upgrade research synthesis)

## Problem

Rendered demos read as static screenshot slideshows: no visible pointer motion between
actions, hard instant cuts on navigation, no camera motion, and a low-bitrate VP8
intermediate that softens text. Judges reward a video that shows the real product in
motion; the current output undersells real captures.

## Goal

A demo rendered from the same DEMO_SCRIPT should look alive: an animated cursor
travels to each interacted element, interacted elements are visibly annotated,
chapters read as styled cards, the camera eases toward the acted-on region and back,
segments open with a soft fade instead of a hard cut, and text stays crisp end to end.
Capture stays fully headless and deterministic; narration is never truncated.

## Scenarios (tracer-bullet slices, dependency order)

### S1 — Frame-accurate high-quality capture (screencast engine)

Given a script shot against a local page, when the demo renders with the default
capture engine, then the captured segment is assembled from screencast frames with
per-frame presentation times derived from capture timestamps, encoded straight to
H.264 (no VP8 intermediate), and the segment's duration equals its narration window
to within one frame. The prior recordVideo engine remains selectable via config as an
escape hatch. If the screencast engine fails to start, the run fails with a clear
error; it never silently falls back to another engine.

### S2 — Native action annotations (cursor, highlights, chapters)

Given a shot with pointer actions, when the demo renders with annotations enabled
(the default), then the output shows an animated cursor moving from action to action
and the interacted element visibly annotated; a chapter action renders as a centered
title card. The legacy injected cursor overlay is automatically suppressed while
native annotations are active, so exactly one cursor is ever visible. Annotation
duration, title font size, and overlay position are configurable.

### S3 — Camera motion toward the action (zoom-on-action)

Given a shot whose actions interact with specific elements, when the demo renders
with zoom-on-action enabled (the default), then for each qualifying interaction the
frame smoothly zooms toward the element's region and eases back out, with zoom level
and easing duration configurable. The interaction event timeline (element bounds +
time offset per action) is persisted alongside the segment as a JSON artifact. Shots
with no qualifying events render unchanged. Zoom never alters segment duration, so
narration and captions stay in sync.

### S4 — Soft segment transitions and smooth scrolling

Given a multi-shot demo, when segments are assembled, then each segment after the
first opens with a brief fade-in (duration configurable, disable-able) and total
duration is unchanged (fades never overlap segments, so audio sync is preserved). A
new `scroll` action scrolls smoothly to a selector or vertical offset instead of
jumping.

## Acceptance criteria

1. Raw captured segments are H.264 MP4 (probe: codec h264), not WebM (S1).
2. Segment duration matches the narration window within one frame period; short
   segments still extend by last-frame freeze, never by trimming audio (S1, existing
   guarantee preserved).
3. Legacy configs validate unchanged; every new knob has a default (S1-S4).
4. Exactly one cursor rendering path is active in any configuration (S2).
5. The interaction event timeline artifact exists for every screencast shot and each
   entry carries kind, element bounds, and a capture-relative time offset (S3).
6. Zoom expression generation is a pure function of the event timeline and render
   parameters, unit-tested numerically at boundary times (S3).
7. Fade-in never changes segment count or total duration (S4).
8. Full suite + typecheck + build green; FAKE_TTS smoke renders a final.mp4 from a
   local file-based fixture page with all features enabled.

## Test seams

- Pure arg/expression builders (ffmpeg argument lists, zoom filter expressions,
  frame-timeline construction from timestamps): unit tests, the repo's existing
  primary seam.
- Config schema defaults and validation: unit tests against parsed config objects.
- Capture drivers stay thin; end-to-end behavior is exercised by the FAKE_TTS smoke
  against a file:// fixture page (hermetic, no server) plus frame extraction review.

## Verification

- run: `FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json`
- expect: `final.mp4`

## Non-goals

- Virtual desktop capture (Xvfb/VNC/OBS): explicitly rejected by the research for
  this pipeline; headless screencast covers the need.
- ffmpeg zoompan (designed for stills), xfade overlap transitions (alters duration
  and audio sync), TTS/caption changes beyond timing anchors.
- Editing the Whisperways submission repo (validation films it read-only).
