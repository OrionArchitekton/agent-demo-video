"""Test stub for faster_whisper: one segment with a word whose timestamps are None.

With STUB_PROMPT_OUT set, it also writes the initial_prompt it was given to that file.
"""
import os
from types import SimpleNamespace as NS


class WhisperModel:
    def __init__(self, *a, **k):
        pass

    def transcribe(self, audio, **k):
        if os.environ.get("STUB_PROMPT_OUT"):
            with open(os.environ["STUB_PROMPT_OUT"], "w", encoding="utf-8") as f:
                f.write(k.get("initial_prompt") or "")
        words = [NS(word=" Hello", start=0.0, end=0.4), NS(word=" lost", start=None, end=None),
                 NS(word=" half", start=0.5, end=None), NS(word=" world", start=0.6, end=1.0)]
        return [NS(words=words)], None
