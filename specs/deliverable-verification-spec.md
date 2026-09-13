# Deliverable Verification: Final-Format Contract and Contact Sheet

## Intent

A render is verified today by parity alone: segment count, audio vs video duration,
and the duration cap. Nothing asserts that the finished video is the deliverable a
distribution platform expects (codec, geometry, pixel format, frame rate, audio), and
nothing produces a reviewable picture of what shipped. An operator or agent has to open
the video to notice a wrong frame, a blank shot, or a broken layout, and a green run
says nothing about any of it.

This change adds two checks that run against the finished video the operator actually
receives, after either a local or a remote render:

1. a **deliverable contract** read from the encoded file itself, which fails the run
   when the file is not the declared deliverable; and
2. a **contact sheet**: one still per shot, taken from the measured timeline, tiled into
   a single image written beside the video, so the whole piece can be reviewed at a
   glance.

## Vocabulary

- **deliverable**: the finished video the pipeline hands to the operator (`final.mp4`).
- **deliverable contract**: the properties the deliverable must have, read from the
  encoded file, never from the config or the encode arguments.
- **measured timeline**: the per-shot start and duration the render report already
  records (post-reconcile), as opposed to the narration estimate.
- **beat**: the moment within a shot that its still is taken from.
- **contact sheet**: the tiled image of one still per shot, in timeline order.

## Scenarios (tracer-bullet slices)

1. **Contract holds on a normal render.** A successful local render's deliverable has
   exactly one video stream and one audio stream; the video is H.264, yuv420p, square
   pixels, no display rotation (players honor it, so a matching coded size alone could
   still show sideways), exactly the configured width and height, at a constant frame rate equal to
   the configured fps (both the declared rate and the measured average rate); the audio
   is AAC. The video track is frame-exact: its duration is within one frame of the
   measured timeline's total, either way. The audio track may end up to two audio frames
   (1024 samples each at the probed sample rate) or one video frame early, whichever is
   longer, and at most one of either late: the final AAC encode ends on a frame boundary
   (measured up to 23ms early at 44.1kHz, 20ms at 48kHz, 40ms at 22.05kHz; never late). The container is within one video or audio
   frame, whichever is longer, either way. A track seconds short fails even when the
   container is intact. The render report records the probed values and `ok: true`.
2. **A violating deliverable fails the run loudly.** When the deliverable the operator
   receives does not meet the contract (for example a remote host returns a file with
   the wrong pixel format or frame rate), the run fails with an error naming every
   mismatched property with its expected and actual value, and no render report is
   written, so the report's existence still means "this artifact shipped".
3. **Contact sheet on every successful render.** One still is taken per measured
   timeline entry at that shot's beat, tiled in timeline order into a PNG beside the
   deliverable. The report records the sheet's path, its grid, and for each still the
   shot id, the time it was taken at, and the still's own path. Every timeline entry is
   a shot for this purpose, including brand cards. A still that yields no frame, and a
   missing or wrongly sized sheet, fail the run rather than being reported. The sheet
   is built only from this run's stills: a reused output directory's earlier sheet and
   stills are removed first, so no image from another render can appear in it.
4. **Remote renders verify the retrieved file.** For a remote render both checks run
   locally against the video that was pulled back. The host's report supplies the
   measured timeline, which only the renderer can measure; before it becomes the
   expectation for the file and the contact-sheet beats, it must name exactly the shots
   this run rendered, in order, contiguously, with a total equal to the last shot's end.
   A report that omits, adds, or reorders shots, or places one out of sequence (a gap,
   an overlap, or a total that is not the last shot's end), fails the run before any
   report is written. Per-shot durations remain the renderer's measurements: the render
   host is trusted to measure its own clips, so a host that consistently re-times shots
   and returns a matching file is outside what this check can detect.
5. **Portrait deliverables.** A shorts render (1080x1920) passes the same contract with
   its own geometry, and its contact sheet tiles portrait stills.

## Constraints

- The contract is read with ffprobe from the deliverable. It must never be satisfied by
  the config, the encode arguments, or the render host's own report. The host's measured
  timeline is used as the expectation only after it is bound to the locally known shot
  list (Scenario 4).
- The duration bounds are two-sided, never a floor or a ceiling alone, and their audio
  frame length comes from the probed sample rate.
- The mux never drops video: the audio is padded so the video always ends the file.
  The pad also fills narration audio that ends before the video with silence, so on a
  local render an early-ending narration is caught by the existing A/V parity check
  (1.5s) rather than by the audio-track bound; that bound protects the delivered file
  itself, such as one damaged on the way back from a render host.
  Previously a stream-copied B-frame video muxed against audio a few ms short lost up
  to a B-frame group of trailing frames (measured 2 to 4), shaving the closing shot.
- Sample rate and channel count are not pinned: real narration and the fake TTS path
  may legitimately differ.
- No stills are taken outside a shot: a beat is clamped so it lands on a frame inside
  its own shot.
- Shot ids and other operator text are never interpolated into ffmpeg filter strings,
  and file names reach ffmpeg as literals, so an output path containing `%` is not
  treated as an image sequence pattern.
- The grid is four tiles across for landscape and six across for portrait, never more
  columns than shots; tiles are 480 pixels wide with square pixels.
- A rerun into a reused output directory invalidates the previous contact sheet at the
  start of the attempt, alongside the previous render report, so a failed attempt never
  leaves another render's evidence behind.
- Existing report fields keep their names and meaning; the new fields are additive.
- Report persistence is unchanged: `render-report.json` is required for source-attested
  production renders and best-effort otherwise (a write failure is warned, not fatal), so
  the recorded `deliverable` and `contactSheet` fields exist wherever the report does.
  The checks themselves always run and always fail the run on a mismatch.

## Acceptance criteria

- AC1: every successful pipeline render (local and remote, landscape and shorts) whose
  report is written records
  `deliverable.ok: true` with the probed codec, pixel format, geometry, declared and
  average frame rate, sample aspect ratio, display rotation, audio codec, container
  duration, video track duration, audio track duration, and audio sample rate.
- AC2: a deliverable with a wrong pixel format or frame rate rejects the run, the error
  names each mismatched property with expected and actual values, and
  `render-report.json` is not written.
- AC3: every successful render writes `contact-sheet.png` beside `final.mp4` with one
  still per timeline entry, and a written report's `contactSheet` lists each still's shot
  id, time, and path in timeline order.
- AC4: the recorded contact-sheet geometry equals the geometry of the written PNG; a
  reused output directory's leftover stills never appear in the sheet, and a still that
  yields no frame rejects the build.
- AC5: pure unit coverage for the contract comparison (each property's mismatch,
  including a variable-frame-rate average, a short video track, a truncated audio track
  behind an intact container, and the two-sided windows) and for beat selection
  (clamping inside short shots).
- AC6: muxing a B-frame video with audio a few ms short keeps every video frame.
- AC7: a render whose reported timeline omits, reorders, or misplaces a rendered shot
  fails before the deliverable is checked and before any report is written.
- AC8: production-pack promotion accepts the contact sheet and exactly one still per
  segment in each artifact, and rejects an extra still or a non-file sheet.

## Test seams

Chosen deliberately, fewest and highest:

- **`runPipeline` with fake TTS** (existing seam, real ffmpeg): scenarios 1, 3, 5 and the
  report fields. This is the seam every current render test already uses.
- **`runPipeline` with a render transport whose retrieved file is deliberately
  re-encoded wrong** (existing remote seam): scenarios 2 and 4, end to end.
- **The contact-sheet builder against a small generated video** (real ffmpeg, no
  capture): AC4's stale-still, missing-frame, and literal-path cases, judged by the
  written pixels and files rather than geometry alone.
- **The mux arguments against a generated B-frame clip** (real ffmpeg): AC6, counting
  the video frames that survive.
- **Pure functions** for the contract comparison and the beat plan: AC5 only, where
  exhaustive edge cases are cheaper than renders.

## Non-goals

- Judging whether a render is good (aesthetics, pacing, blank or frozen shots). The
  contact sheet makes that review possible; it does not automate it.
- Vision-model review of the stills.
- Changing the encode policy or the remote transport. The mux gains an audio pad so
  it stops dropping video frames; codecs, quality settings, and the transport are
  unchanged.
