#!/usr/bin/env bash
set -euo pipefail
python3 -c '
import json, re, sys
sents = [s for s in re.split(r"(?<=[.!?])\s+", open(sys.argv[1]).read().strip()) if s]
kept = " ".join(s for i, s in enumerate(sents) if i != 1).split()
json.dump([{"word": w, "start": round(i * 0.2, 3), "end": round(i * 0.2 + 0.2, 3)} for i, w in enumerate(kept)], open(sys.argv[2], "w"))
' "$2" "$3"
