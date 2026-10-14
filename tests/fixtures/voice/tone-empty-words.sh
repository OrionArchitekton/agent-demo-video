#!/usr/bin/env bash
# Fixture voice command: 1.5 s tone plus an EMPTY word timings list in <out>.words.json.
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1.5" "$4"
echo "[]" > "$4.words.json"
