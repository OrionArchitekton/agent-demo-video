#!/usr/bin/env bash
# Ignores SIGTERM (and so does its child); writes the child's pid to $1.
trap '' TERM
sleep 30 &
echo $! > "$1"
wait
