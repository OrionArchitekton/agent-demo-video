#!/usr/bin/env bash
# Fixture voice command: 1.5 s tone but word timings that run to about 30 s.
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1.5" "$4"
python3 -c '
import json, sys
words = open(sys.argv[1]).read().split()
step = 30.0 / max(len(words), 1)
json.dump([{"word": w, "start": round(i * step, 3), "end": round((i + 1) * step, 3)} for i, w in enumerate(words)], open(sys.argv[2], "w"))
' "$2" "$4.words.json"
