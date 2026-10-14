#!/usr/bin/env bash
set -euo pipefail
python3 -c '
import json, sys
words = open(sys.argv[1]).read().split()
json.dump([{"word": w, "start": round(i * 0.2, 3), "end": round(i * 0.2 + 0.2, 3)} for i, w in enumerate(words)], open(sys.argv[2], "w"))
' "$2" "$3"
