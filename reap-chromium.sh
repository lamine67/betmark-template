#!/bin/bash
THRESHOLD_SEC=2400

ps -eo pid,etimes,cmd | grep 'chrome-headless-shell' | grep -v grep | while read -r pid etimes rest; do
  if [ "$etimes" -gt "$THRESHOLD_SEC" ]; then
    kill -9 "$pid" 2>/dev/null
    echo "$(date -u '+%F %T') reaped chrome-headless-shell pid=$pid age=${etimes}s"
  fi
done
