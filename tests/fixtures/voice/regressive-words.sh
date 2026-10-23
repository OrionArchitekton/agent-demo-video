#!/usr/bin/env bash
# Exercise the actual voice/aligner boundary with backwards timestamps.
set -euo pipefail
base="$(dirname "$0")"
if [[ "$1" == "voice" ]]; then
  bash "$base/tone-words.sh" --text-file "$2" --out "$3"
  words="$3.words.json"
else
  bash "$base/align-even.sh" "$1" "$2" "$3"
  words="$3"
fi
python3 - "$words" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as handle:
    rows = json.load(handle)
rows[1]['start'] = rows[0]['start']
rows[1]['end'] = rows[0]['end'] / 2
with open(path, 'w') as handle:
    json.dump(rows, handle)
PY
