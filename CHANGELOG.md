# Changelog

## 0.3.0

### Breaking

- A missing `ELEVENLABS_API_KEY` is now an error instead of silently selecting
  silent placeholder narration. Previously a forgotten credential produced a
  complete, correctly-timed, captioned video with no voice at all, and the
  parity check could not detect it because the estimated duration is the clock.
  Set `FAKE_TTS=1` to request silent narration deliberately.

### Added

- `maxDurationSec` (default 300) declares the finished video's length ceiling.
  It replaces a hardcoded constant and is carried across the render manifest, so
  a remote render enforces the same limit as a local one.
- `capture.settleMs` (default 500) budgets a readiness wait after the opening
  navigation and before recording starts: web fonts ready and visible images
  decoded. Fails open, warning and recording anyway. `0` disables it silently.
- `<out>/render-report.json` records what produced a render: resolved voice and
  model, toolchain versions, config and script digests, the measured per-shot
  timeline, and the parity result.

### Fixed

- Every config schema object now rejects unrecognised keys, so a typo in a
  setting fails loudly instead of silently applying the default it was written
  to override.
- Offloading to a remote render bundle older than the local sources is refused.
  A stale bundle ran an old renderer that ignored the declared duration cap.
