#!/usr/bin/env bash
# Exits 0 but leaves a background helper holding the inherited stdout and stderr.
# Writes the helper's pid to $1 (when given) so a test can clean it up.
sleep 20 &
[ -n "${1:-}" ] && echo $! > "$1"
echo ok
exit 0
