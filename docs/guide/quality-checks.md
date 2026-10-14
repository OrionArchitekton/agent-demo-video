# Quality checks

Three checks and fixes that guard a render against problems the format checks cannot see.

**Transcript check.** When `voice.aligner` is configured, the pipeline runs the aligner once more
over the finished `final.mp4` with the whole narration as its text, after the deliverable is
verified. This happens even when the voice command wrote its own word timings. Recognized words
are matched to the script in order, spelling-insensitively ("A.I." matches "AI", "log in" matches
"login"). A narration sentence with under 70% of its words heard is a dropped phrase.
`render-report.json` records `transcriptCheck` as `{ ran: true, droppedPhrases }`, or
`{ ran: false, reason }` when no aligner is configured or the check could not run, and a warning
lists at most 5 dropped phrases. The check is advisory and never fails a render: an aligner failure
here is recorded as the reason and the render still succeeds (only a failure during narration
timing stops a render). Recognizers can mishear names and spelled-out numbers, so read the list as
a prompt to listen, not a verdict.

- The check needs an aligner that transcribes the audio. The bundled `tools/align_whisper.py`
  transcribes. A forced aligner, which emits a timing for every script word whatever was said,
  will never report a dropped phrase.
- `voice.timeoutSec` also bounds this whole-video alignment, so set it for the full video length.
- `FAKE_TTS=1` dry runs skip the check (`ran: false`): their narration is silent.

**Headless display isolation.** Every headless browser (capture, live capture, preflight, and a
login configured to run headless) launches without `DISPLAY` and `WAYLAND_DISPLAY`, so a dead
desktop display (for example WSLg after its compositor crashes) no longer stalls capture. There is
nothing to configure. The interactive (headed) login browser keeps the full environment.

**Title card hook (`brand.hook`).** An optional line of 1 to 60 characters drawn large on the
title card's first frame (no fade-in), each line centered, with the product name small beneath it.
It wraps and shrinks to fit the frame width and half its height, down to a minimum size. The fit
uses an estimate of character widths, so a very long single word, or a hook with no spaces, may
still overflow at the minimum size.

```json
"brand": { "title": "WorkCue", "hook": "Your standup, written for you" }
```

A Shorts render (`platform: "shorts"`) with a title card but no hook prints a warning and records
`hook: "missing"` in the report (`"set"` when a hook is present). A hook with the title card
disabled is not shown and prints a warning.

Back to the [README](../../README.md).
