#!/usr/bin/env bash
# Fixture aligner: evenly spaced timings that run to about 30 s.
set -euo pipefail
python3 -c '
import json, sys
words = open(sys.argv[1]).read().split()
json.dump([{"word": w, "start": i * 5.0, "end": i * 5.0 + 5.0} for i, w in enumerate(words)], open(sys.argv[2], "w"))
' "$2" "$3"
