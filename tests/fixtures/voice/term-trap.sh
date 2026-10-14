#!/usr/bin/env bash
# Stands in for a CLI that shuts down cleanly on SIGTERM: writes "term" to $1, then exits 0.
# Writes its pid to $2 (when given) once the trap is installed.
trap 'printf term > "$1"; exit 0' TERM
sleep 30 &
if [ -n "$2" ]; then echo $$ > "$2"; fi
wait
