#!/bin/bash
BETMARK_HOME="${BETMARK_HOME:-$(cd "$(dirname "$0")" && pwd)}"; export BETMARK_HOME
# FULL + BOOKD-FULL планировщик - широкий охват (все лиги, не только топ-6)
cd $BETMARK_HOME || exit 1

LOCKFILE=/tmp/odds-sync-full.lock
exec 200>"$LOCKFILE"
flock -n 200 || { echo "$(date -u '+%F %T') full sync already running, skip"; exit 0; }

eval "$(node read-sync-config.js)"

LOG=$BETMARK_HOME/sync.log

if [ "$FULLSCAN_ON" != "true" ]; then
  exit 0
fi

FULL_MARKER=/tmp/odds-sync-full.last
now=$(date +%s)
last=$(cat "$FULL_MARKER" 2>/dev/null || echo 0)
if [ "$FULL_INTERVAL" -gt 0 ] && [ $((now - last)) -lt "$FULL_INTERVAL" ]; then
  exit 0
fi
date +%s > "$FULL_MARKER"

run_bg() {
  local label="$1"; shift
  ( echo "--- $(date -u '+%F %T') syncing $label ---" >> "$LOG"
    local out status
    out=$("$@" 2>&1)
    status=$?
    echo "$out" >> "$LOG"
    if [ $status -ne 0 ]; then echo "!!! $(date -u '+%F %T') $label FAILED" >> "$LOG"; fi
    # Та же проверка, что в sync-scheduler.sh (fast+tennis)
    if echo "$out" | grep -qE 'собрано 0 матч'; then
      msg="!!! $(date -u '+%F %T') $label - КОНТОРА НЕАКТУАЛЬНА (0 матчей собрано, хотя включена в поиск)"
      echo "$msg" >> "$LOG"
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')] $msg" >> $BETMARK_HOME/anomalies.log
    fi
  ) &
}

echo "=== $(date -u '+%F %T') FULL sync start ===" >> "$LOG"
[ "$BK_BOOKB_ON" = "true" ] && run_bg "bookb (full)" npx tsx sync-bookb.ts full
[ "$BK_BOOKC_ON" = "true" ] && run_bg "bookc (full)" npx tsx sync-bookc.ts full
[ "$BK_BOOKF_ON" = "true" ] && run_bg "bookf (full)" npx tsx sync-bookf.ts full
[ "$BK_BOOKD_ON" = "true" ] && run_bg "bookd (full)" npx tsx sync-bookd.ts full
[ "$BK_BOOKG_ON" = "true" ] && run_bg "bookg (full)" npx tsx sync-bookg.ts full
[ "$BK_BOOKH_ON" = "true" ] && run_bg "bookh (full)" npx tsx sync-bookh.ts full
wait
echo "=== $(date -u '+%F %T') FULL sync end ===" >> "$LOG"
