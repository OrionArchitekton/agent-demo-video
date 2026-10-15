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
import unicodedata

from faster_whisper import WhisperModel


MAX_WORD = 24


def glossary(script, limit=220):
    """Distinct words of 4 to 24 characters, sorted, kept while they fit in `limit` UTF-8 bytes.

    Words are Unicode letters (accented, Cyrillic and other scripts stay whole); a longer run, such
    as a CJK clause with no spaces, is skipped so no sentence of the script lands in the prompt.
    The script's first word is left out: faster-whisper feeds the prompt as the tokens spoken just
    before the audio, so naming the opening word there invites Whisper to skip it. The cap counts
    bytes because Whisper limits the prompt to 224 tokens and a token never covers less than one
    byte, so a non-Latin glossary cannot overflow and be cut by the model.
    """
    script = unicodedata.normalize("NFC", script)  # combining accents join their letters
    eligible, seen = [], set()
    for w in re.findall(r"[^\W\d_](?:[\w'-]*[^\W_])?", script):
        if 4 <= len(w) <= MAX_WORD and w.lower() not in seen:
            seen.add(w.lower())
            eligible.append(w)
    words = sorted(eligible[1:], key=str.lower)
    # The label must not echo the opening either, if the script happens to start with it.
    label = "Terms: " if eligible and eligible[0].lower() == "glossary" else "Glossary: "
    items, size = [], len(label.encode("utf-8"))
    for w in words:
        add = len(w.encode("utf-8")) + (2 if items else 0)
        if size + add > limit:
            continue
        items.append(w)
        size += add
    return label + ", ".join(items) if items else None


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
