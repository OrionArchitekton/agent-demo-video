# Use your own voice (command provider)

Any TTS you can run from a shell can narrate. Set `voice.provider` to `"command"` and give an
argument list; `{text}` is a file holding the shot's narration and `{out}` is where your program
must write audio (any format ffmpeg reads). No shell is involved.

```json
"voice": {
  "provider": "command",
  "command": ["my-tts", "--text-file", "{text}", "--out", "{out}"],
  "aligner": ["/path/to/venv/bin/python", "/path/to/agent-demo-video/tools/align_whisper.py", "{audio}", "{text}", "{out}"],
  "timeoutSec": 600
}
```

`voice.provider` and `voice.timeoutSec` are optional: leaving the provider out selects ElevenLabs, and the timeout falls back to 600 s.

Per-shot word timings must keep both start and end timestamps nondecreasing in the supplied
word order. Equal timestamps and overlapping words are accepted. A backward start
or end stops the render and identifies the provider and zero-based word index;
the renderer does not sort, silently clamp, or substitute estimated timings for
malformed input. The final-video transcript check remains advisory, including
when its aligner supplies backward timestamps.

If you see `word timings regress at index 1`, inspect the second word and the
word immediately before it in the provider's JSON. For example, starts of
`0.5, 0.4` move backward; ends of `0.7, 0.6` also move backward even if the starts
increase. Fix the timestamps in the voice command or aligner while keeping the
spoken word sequence. Ordinary overlap, such as `[0.0, 0.5]` followed by
`[0.4, 0.8]`, is valid and needs no repair. Malformed provider timings stop before
the configured caption aligner; malformed per-shot aligner timings stop before estimation.

Word-pop captions need word timings. They come from, in order: a `{out}.words.json` your command
writes (`[{"word", "start", "end"}]`, seconds, at most 5 MB), the optional `aligner`, or a
proportional estimate. If the voice command writes word timings, they win and the aligner is not
run for caption timing. (When an aligner is configured it still runs once more, over the finished
`final.mp4`, for the [transcript check](quality-checks.md).) The render report records which one each
shot used (`narration[].timing`), and the run warns when any shot was estimated. During narration
timing, a failing command or aligner, a timeout, audio under 0.3 s, or timings that match under 60%
of the script's words stop the render with the shot and the cause. An aligner failure during the
transcript check never stops the render; the report records the reason instead.

The package ships a reference aligner, `tools/align_whisper.py`. For a global npm install the
script is at `$(npm root -g)/agent-demo-video/tools/align_whisper.py`; install faster-whisper in a
virtual environment (`python3 -m venv .venv && .venv/bin/pip install faster-whisper`) and use that
python, as in the example above.

In the aligner, `{audio}` is the narration your command produced, `{text}` is the narration
file, and `{out}` is the aligner's own output path, which it fills with the same
`[{"word", "start", "end"}]` JSON. Relative paths resolve from the directory you run the render
in. `timeoutSec` applies to each command and aligner call separately, and it also bounds the
transcript check's single alignment of the whole finished video, so set it long enough for the
full video length, not just one shot. The reference aligner
defaults to the English `small.en` model (downloaded on first use); set `ALIGN_MODEL` for other
languages (for example `small`) and `ALIGN_THREADS` for CPU threads. `FAKE_TTS=1` still gives a
keyless silent dry run; dry runs skip the transcript check, since their narration is silent.

Notes:

- Commands run without a shell, in their own process group. On timeout the whole group is
  killed. When the command exits, successfully or with an error, helpers remaining in
  that group are killed after the bounded output drain (at most 250 ms); a completed
  command must not leave background work running.
  This relies on POSIX process groups (Linux and macOS; not supported on Windows).
  Helpers that create a separate session or process group are outside this cleanup scope;
  the command must stop those helpers itself before exiting.
  Commands must also stop helpers whose changed credentials prevent the CLI from signalling
  them. Reported signal failures other than an already-absent group produce a cleanup
  warning; the command's original result is preserved.
  A short-lived Node supervisor owns the group through cleanup, so cleanup never targets
  a retired group ID. Allow approximately 250 ms per invocation for the final output drain.
- The last lines of a failing command's stderr appear in the error message and the logs, so
  voice commands must not print secrets.

Back to the [README](../../README.md).
