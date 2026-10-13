#!/usr/bin/env bash
set -euo pipefail
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=0.1" "$4"
