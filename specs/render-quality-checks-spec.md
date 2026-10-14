# Render Quality Checks: transcript check, headless display isolation, Shorts hook card

## Intent

Three gaps showed up while rendering real narrated demos:

1. A render can pass every format check while saying something other than the script (a voice
   that swallows a short sentence, a clipped take). Nothing listens to the finished video.
2. On a workstation whose desktop display is set but no longer answering (common on WSL after a
   display server crash), every headless browser capture stalls about 30 seconds and fails, even
   though capture never needs a display. The failure names a page element, never the display.
3. Shorts viewers decide in the first seconds. Measured on short-form channels, openings that
   show a large, legible hook line on the very first frame hold far more viewers at 3 seconds
   than openings that show a name or abstract visuals. The cold-open card shows only the product
   name.

## Vocabulary

- **transcript check**: after a render, the finished video's speech is recognized and compared
  with the script's narration; script phrases the recognizer did not hear are listed.
- **dropped phrase**: a narration phrase (a sentence or clause) fewer than 70% of whose
  words were matched, in order, in the recognized speech.
- **headless capture**: any browser the pipeline launches without a window (all shot capture and
  preflight). The interactive login flow is not headless and is unaffected.
- **hook line**: a short line of text, set by the author, shown large on the first frame.
- **title card**: the existing cold-open card at the start of the video.

## Scenarios (tracer-bullet slices)

1. **The render is checked against its script.** When an aligner is configured (the word
   aligner from the command voice provider), after the deliverable is verified the aligner is run
   once over the finished video's audio with the whole narration as its text. Recognized words
   are compared with the narration phrase by phrase (so "A.I." matches
   "AI" and "log in" matches "login"): recognized words are matched to the narration words in
   order, with the same spelling-insensitive matching used for caption timing; a phrase counts as
   heard when at least 70% of its words are matched; others are reported as dropped. The render
   report records the result (`transcriptCheck: { ran, droppedPhrases }`); dropped phrases also print a warning. The check is
   advisory: it never fails a render. With no aligner configured it records `ran: false` with the
   reason, and nothing else changes. If the aligner itself fails during the check, the render still
   succeeds and the report records the failure reason.
2. **Headless capture ignores the desktop display.** Every headless browser the pipeline launches
   (shot capture, live capture, preflight) starts with the desktop display variables removed from
   its environment, so a dead display can no longer stall capture. The interactive login browser
   keeps the full environment. The pipeline's own environment is not modified.
3. **A Shorts render can open on a hook.** A new optional `brand.hook` text (at most 60
   characters) is drawn large and centered on the title card, with the product name small beneath
   it, for any platform. When a Shorts render (`platform: "shorts"`) has a title card but no hook,
   the run prints a warning and the report records `hook: "missing"`; with a hook it records
   `hook: "set"`. Landscape renders without a hook record nothing and print nothing.

## Out of scope

- Failing a render on transcript drops (it stays advisory; recognizers mishear names and spelled
  numbers).
- Measuring frame brightness or legibility automatically.
- Shipping the pre-render reviewer agent (moved to the packaging work).

## Acceptance criteria

- AC1: with a fixture aligner that "hears" every narration word, the report records
  `transcriptCheck.ran: true` and no dropped phrases; with one that omits a sentence, that sentence
  is listed and a warning prints; with no aligner, `ran: false` and the render is otherwise
  unchanged.
- AC2: phrase comparison treats "A.I." and "AI", "Work Cue" and "WorkCue" as heard, and flags a
  phrase whose words are absent.
- AC3: with `DISPLAY` set to an unreachable display, the existing browser smoke tests pass without
  the operator unsetting it; the login flow's launch options still carry the full environment.
- AC4: a Shorts render with `brand.hook` shows the hook on the first frame (title card text
  positioned and sized above the product name); a Shorts render without one warns and records
  `hook: "missing"`; a landscape render without one records nothing.
- AC5: existing configs (no hook, no aligner) render and report exactly as before apart from the
  new `transcriptCheck: { ran: false, ... }` field.

## Test seams

Existing seams only: the pure phrase-comparison function (unit tests), the browser-launch options
builder (unit tests on the environment passed to headless vs login launches), the title-card
argument builder (unit tests on drawn text and sizes), and the pipeline smoke test (one end-to-end
command-voice render with a fixture aligner for the transcript check, and one Shorts render for the
hook record).
