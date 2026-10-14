#!/usr/bin/env python3
"""Reference aligner for agent-demo-video's command voice provider (specs/command-tts-provider-spec.md).

Usage: align_whisper.py <audio> <text-file> <out.json>
Writes [{"word", "start", "end"}] from faster-whisper word timestamps on CPU. The pipeline maps
these onto the script's own words, so recognizer spelling never reaches the captions; the script
text is passed as a prompt only to steer recognition.
Env: ALIGN_MODEL (default small.en), ALIGN_THREADS (default 4).
"""
import json
import os
import sys

from faster_whisper import WhisperModel

if len(sys.argv) != 4:
    sys.exit(__doc__)
audio, text_path, out = sys.argv[1:4]
with open(text_path, encoding="utf-8") as f:
    script = f.read()
prompt = script[:200].rsplit(" ", 1)[0] if len(script) > 200 else script
model = WhisperModel(os.environ.get("ALIGN_MODEL", "small.en"), device="cpu", compute_type="int8",
                     cpu_threads=int(os.environ.get("ALIGN_THREADS", "4")))
segments, _ = model.transcribe(audio, word_timestamps=True, initial_prompt=prompt)
words = [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
         for s in segments for w in (s.words or [])
         if w.word.strip() and w.start is not None and w.end is not None]
with open(out, "w", encoding="utf-8") as f:
    json.dump(words, f)
