#!/bin/bash
BETMARK_HOME="${BETMARK_HOME:-$(cd "$(dirname "$0")" && pwd)}"; export BETMARK_HOME
# Полный обход лиг ОДНОЙ конторы на своём таймере
slug="$1"
[ -n "$slug" ] || exit 1
cd $BETMARK_HOME || exit 1
exec 201>/tmp/odds-full-$slug.lock
flock -n 201 || exit 0
eval "$(node read-sync-config.js)"
var="BK_$(echo "$slug" | tr a-z A-Z)_ON"
[ "${!var}" = "true" ] || exit 0
LOG=$BETMARK_HOME/sync.log
echo "--- $(date -u '+%F %T') syncing $slug (full, own timer) ---" >> "$LOG"
out=$(timeout 1800 npx tsx sync-$slug.ts full 2>&1); status=$?
echo "$out" >> "$LOG"
[ $status -ne 0 ] && echo "!!! $(date -u '+%F %T') $slug (full) FAILED" >> "$LOG"
exit 0
