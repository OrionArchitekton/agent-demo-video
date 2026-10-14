# Command TTS Provider and Word Aligner

## Intent

Real narration has exactly one source today: a hosted TTS service whose response carries
per-character timestamps, which drive the word-pop captions. Without that service's key and
paid account the pipeline cannot produce a narrated video at all; it can only render a silent
dry run. A creator who already has a voice (a local model, a cloned voice they own, any TTS
they can run from a shell) has no way to plug it in.

This change adds a second voice provider that runs any operator-supplied command, and a word
aligner that recovers word timings from finished audio when the voice does not report them.
The hosted provider stays available and remains the default, so existing configs behave
exactly as before.

## Vocabulary

- **voice provider**: where narration audio comes from. `"elevenlabs"` (the hosted service,
  default) or `"command"` (an operator-supplied program).
- **voice command**: the program the command provider runs once per shot. It receives the
  shot's narration text and writes an audio file.
- **word timings**: a list of `{word, start, end}` in seconds, relative to the shot's audio.
- **aligner**: an optional program that reads finished audio plus the narration text and
  writes word timings. It supplies TIMES only; caption text is always the script's own words.
- **timing source**: how a shot's caption timing was obtained: `provider` (the voice reported
  word timings), `aligned` (the aligner produced them), or `estimated` (proportional estimate
  from text length).

## Scenarios (tracer-bullet slices)

1. **Default unchanged.** A config with no `voice.provider`, or `"elevenlabs"`, renders exactly
   as today, including the requirement for the hosted service's key. The keyless dry run
   (`FAKE_TTS=1`) is unchanged for every provider.
2. **A command voice renders real narration.** With `voice.provider: "command"` and a
   `voice.command` argument list, each shot's narration is written to a text file, the command
   runs with `{text}` and `{out}` placeholders substituted (no shell; arguments passed as a
   list), and the audio it writes becomes that shot's narration. No hosted-service key is
   needed.
3. **Timing comes from the best available source, in order.** If the voice command also writes
   word timings next to its audio, they are used (`provider`); an empty list counts as none.
   Otherwise, if `voice.aligner` is configured, it runs and its word timings are used
   (`aligned`). Otherwise the existing proportional estimate is used (`estimated`). Word
   timings are mapped onto the script's own words, so captions never show the recognizer's
   spelling; script words the timings miss are interpolated between their neighbours.
4. **Failures stop the render with a named reason.** A missing program, a non-zero exit, a
   timeout (`voice.timeoutSec`), missing or near-empty audio (under 0.3 s), or a malformed word
   timings file stops the render. A configured aligner that fails, or whose timings match fewer
   than 60% of the script's words, also stops the render: it never falls back to the estimate
   silently.
5. **The report says how each shot was timed and which voice made it.** The render report
   carries a per-shot narration list recording each shot's timing source. For the `command`
   provider, the report's voice block records the provider, the program names of the voice
   command and the aligner, and the timeout; it never stores their full arguments or paths,
   which can carry keys and machine-local locations. For every other provider the voice block
   is the configured voice, unchanged. When any shot of a `command` render is `estimated`, the
   run prints a warning naming those shots and the render still passes. Near-empty narration
   never reaches the report: it stops the render (scenario 4).
6. **A reference aligner ships with the project.** An optional aligner script using
   faster-whisper on CPU implements the aligner contract, so a creator with Python can get
   aligned timings without writing their own.

## Out of scope

- A built-in local voice model or a recommended public default voice (planned with packaging
  and adoption work).
- Operator-specific voice adapters (for example, a creator's own cloned-voice setup). Those
  live with the operator, outside this repository, and plug in through the command contract.
- Changing how captions render; only where their timings come from changes.

## Acceptance criteria

- AC1: an existing config (no provider, or `"elevenlabs"`) sends the same requests to the hosted
  service and writes the same render report as before, apart from the new per-shot narration
  timing list; its voice block is still the configured voice, so archived reports still match
  their configs.
- AC2: a `command` render with a fixture voice command (generates a tone, writes no timings) and
  no aligner completes, reports every shot as `estimated`, passes verification, and the run
  prints a warning naming the estimated shots. Its report's voice block holds only the provider,
  the program name, and the timeout.
- AC3: the same render with a fixture voice command that writes word timings reports
  `provider`, and caption word times equal the fixture's times.
- AC4: word-timing mapping keeps the script's spelling, interpolates missed words, and rejects
  coverage under 60%.
- AC5: each failure in scenario 4 stops the render with an error naming the shot and the cause.
- AC6: an operator render with a real cloned voice through the command contract and the
  reference aligner produces a narrated video whose verification passes and whose contact sheet
  shows captions in sync (operator evidence, recorded in the PR; not run in CI).

## Test seams

Two seams, both existing: the TTS stage's per-shot synthesis function (unit tests with fixture
commands and fixture word-timing files) and the pipeline smoke test (one end-to-end `command`
render with a tone-generating fixture command). The reference aligner is exercised by its own
small test over a fixture audio file when faster-whisper is available, and skipped otherwise.
