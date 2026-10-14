#!/usr/bin/env bash
# Fixture voice command: ignores the words, writes a 1.5 s tone. No word timings.
set -euo pipefail
[ -s "$2" ] || { echo "empty narration file" >&2; exit 2; }
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=1.5" "$4"
