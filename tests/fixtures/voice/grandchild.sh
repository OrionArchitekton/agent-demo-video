#!/usr/bin/env bash
sleep 30 &
echo $! > "$1"
wait
