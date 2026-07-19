# Production Polish - Spec

Status: active (the 7-to-9 slate; follows screencast-upgrade-spec.md)

## Problem

Renders read as excellent screencasts, not produced pieces. Operator verdict on the
screencast engine output: 7/10. The gap to 8-9 is presentation craft: raw full-bleed
viewport, dry narration over silence, block captions, in-out-per-event zoom, and a
cold start on the app.

## Goal

The same DEMO_SCRIPT renders as a produced piece: the app floats as a framed window
on a styled backdrop; a subtle music bed sits under the narration with clicks and
transitions audible; captions appear word by word in sync with speech; the camera
lives at a gentle base zoom and travels between action targets instead of resetting;
the video opens and closes on branded cards; narration uses a quality voice tier.
Every feature is a config knob with a sane default and a clean off-switch, and legacy
configs still validate and render.

## Scenarios (tracer-bullet slices, dependency order)

### S1 - Scene framing

Given any shot, when the demo renders with framing enabled (default), then the
captured viewport appears scaled inside a rounded-corner window with a soft shadow,
centered on a generated gradient backdrop, at the configured output resolution.
Framing is applied once per segment in normalization, changes no durations, and
disabling it restores the exact full-bleed layout.

### S2 - Sound design (synthesized, zero-license)

Given a rendered demo, when sound design is enabled (default), then a subtle
synthesized ambient bed plays under the narration, ducking automatically while
narration is audible; each recorded click event lands an audible soft tick at its
capture offset; segment boundaries carry a quiet transition sweep. All sound is
synthesized at render time (no bundled media assets, no licensing surface). An
operator-supplied music file may replace the ambient bed via config. Narration
loudness and caption sync are unchanged.

### S3 - Word-pop captions

Given narration alignment from TTS, when word-pop captions are enabled (default),
then captions render as word-level events: each word appears at its spoken time in a
styled lower-third (semi-bold, outlined, accent on the active word), replacing the
block-SRT burn. The SRT artifact is still written for accessibility/upload use. If
alignment is unavailable (FAKE_TTS), captions fall back to timed word estimates from
narration length, never to nothing.

### S4 - Living camera

Given a shot's interaction event timeline, when the living camera is enabled
(default), then the frame holds a gentle base zoom with a slow drift, eases toward
each action target and on to the next rather than returning to wide between events,
and eases back to the base state at the end of the shot. Camera motion never alters
segment duration or frame count. With no events, the base zoom and drift still apply
(no static full-wide shots).

### S5 - Brand cards

Given brand config (title, subtitle, url, accent color), when cards are enabled
(default when brand config present), then the video opens with a ~2s title card and
closes with a ~3s end card carrying the url, both styled on the backdrop gradient
with fades, counted as ordinary segments (music continues under them; no narration).

### S6 - Narration quality tier

Given a real render, when no explicit voice model is configured, then TTS uses the
ElevenLabs quality tier (not the flash/latency tier) with a curated default voice,
still requesting per-character timestamps; flash remains selectable. FAKE_TTS
behavior is unchanged.

## Acceptance criteria

1. All features on: a FAKE_TTS smoke renders end to end with framing, bed + ticks,
   word-pop captions, living camera, and cards present in extracted frames/audio
   probes (S1-S5).
2. All features off: output is pixel-comparable to the pre-slate engine (legacy
   layout, block SRT, per-event zoom, no cards, no bed) (S1-S5).
3. Legacy configs validate unchanged; every new knob has a default (S1-S6).
4. No new runtime dependencies and no bundled binary media assets (S2).
5. Camera/caption/audio timing all derive from existing artifacts (event timeline,
   TTS alignment, segment durations); durations and parity checks unchanged (S2-S4).
6. Pure generators (backdrop/mask filtergraphs, duck/tick argument builders, ASS
   caption text, camera keyframe expressions) are unit-tested (S1-S4).
7. Full suite + typecheck + build green; the three staged demo videos re-render
   successfully with the slate for operator A/B review.

## Test seams

- Pure argument/filtergraph/subtitle-text builders: unit tests (primary seam).
- Config schema defaults and validation: unit tests.
- End-to-end: FAKE_TTS smoke on demos/smoke plus frame extraction and audio stream
  probes (bed present, tick at click offset).

## Verification

- run: `FAKE_TTS=1 pnpm demo demos/smoke/demo.config.json`
- expect: `final.mp4`

## Non-goals

- Bundled licensed music, external asset downloads, new npm dependencies.
- Vendor TTS swap (OpenAI/Gemini): rejected; per-character alignment from ElevenLabs
  is load-bearing for caption sync (forced alignment would add drift risk).
- Editor-style manual timelines; everything stays derived and deterministic.
