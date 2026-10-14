#!/usr/bin/env python3
"""Reference aligner for agent-demo-video's command voice provider (specs/command-tts-provider-spec.md).

Usage: align_whisper.py <audio> <text-file> <out.json>
Writes [{"word", "start", "end"}] from faster-whisper word timestamps on CPU. The pipeline maps
these onto the script's own words, so recognizer spelling never reaches the captions. A sorted
glossary of the script's words is passed as the prompt to steer spelling. The script's own text is
never the prompt: Whisper reads a prompt as text already spoken and skips audio that repeats it.
Env: ALIGN_MODEL (default small.en), ALIGN_THREADS (default 4).
"""
import json
import os
import re
import sys

from faster_whisper import WhisperModel


def glossary(script, limit=220):
    """Distinct words of four or more letters, sorted, capped at `limit` characters on a whole word."""
    seen = {}
    for w in re.findall(r"[A-Za-z][A-Za-z'-]+", script):
        if len(w) >= 4 and w.lower() not in seen:
            seen[w.lower()] = w
    items = []
    for w in sorted(seen.values(), key=str.lower):
        if len("Glossary: " + ", ".join(items + [w])) > limit:
            break
        items.append(w)
    return "Glossary: " + ", ".join(items) if items else None


if len(sys.argv) != 4:
    sys.exit(__doc__)
audio, text_path, out = sys.argv[1:4]
with open(text_path, encoding="utf-8") as f:
    script = f.read()
prompt = glossary(script)
model = WhisperModel(os.environ.get("ALIGN_MODEL", "small.en"), device="cpu", compute_type="int8",
                     cpu_threads=int(os.environ.get("ALIGN_THREADS", "4")))
segments, _ = model.transcribe(audio, word_timestamps=True, initial_prompt=prompt)
words = [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
         for s in segments for w in (s.words or [])
         if w.word.strip() and w.start is not None and w.end is not None]
with open(out, "w", encoding="utf-8") as f:
    json.dump(words, f)
