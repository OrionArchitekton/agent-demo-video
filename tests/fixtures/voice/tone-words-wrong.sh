#!/usr/bin/env bash
# Fixture voice command: 1.5 s tone plus NON-empty word timings that match none of the script.
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1.5" "$4"
echo '[{"word": "zzz", "start": 0, "end": 1}]' > "$4.words.json"
