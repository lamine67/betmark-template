#!/bin/bash
BETMARK_HOME="${BETMARK_HOME:-$(cd "$(dirname "$0")" && pwd)}"; export BETMARK_HOME
FORCE_FILE=/tmp/odds-sync-force
if [ "$1" = "--force" ]; then
  date +%s > "$FORCE_FILE"
  exit 0
fi

cd $BETMARK_HOME || exit 1

LOCKFILE=/tmp/odds-sync-fast.lock
exec 200>"$LOCKFILE"
flock -n 200 || { echo "$(date -u '+%F %T') fast sync already running, skip"; exit 0; }

LOG=$BETMARK_HOME/sync.log

run_job() {
  local label="$1"; shift
  echo "--- $(date -u '+%F %T') syncing $label ---" >> "$LOG"
  local out status
  out=$("$@" 2>&1)
  status=$?
  echo "$out" >> "$LOG"
  if [ $status -eq 0 ] && echo "$out" | grep -qE 'собрано 0 матч'; then
    sleep 20
    echo "--- $(date -u '+%F %T') retry $label (0 матчей) ---" >> "$LOG"
    out=$("$@" 2>&1)
    status=$?
    echo "$out" >> "$LOG"
  fi
  if [ $status -ne 0 ]; then echo "!!! $(date -u '+%F %T') $label FAILED" >> "$LOG"; fi
  # Контора включена (иначе цепочка не была бы запущена), но вернула 0 матчей
  if echo "$out" | grep -qE 'собрано 0 матч'; then
    local msg="!!! $(date -u '+%F %T') $label - КОНТОРА НЕАКТУАЛЬНА (0 матчей собрано, хотя включена в поиск)"
    echo "$msg" >> "$LOG"
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')] $msg" >> $BETMARK_HOME/anomalies.log
  fi
}

football_job() {
  run_job "$1" npx tsx "sync-$1.ts"
}

# Одна цепочка конторы
chain() {
  local slug="$1"
  exec 200>&- # блокировка надсмотрщика цепочкам не нужна
  exec 201>"/tmp/odds-sync-bk-$slug.lock"
  flock -n 201 || exit 0
  date +%s > "/tmp/odds-sync-bk-$slug.last"
  [ "$FOOTBALL_ON" = "true" ] && football_job "$slug"
  if [ "$HOCKEY_ON" = "true" ] && [ -f "sync-${slug}-hockey.ts" ]; then run_job "$slug-hockey" npx tsx "sync-$slug-hockey.ts"; fi
  # у Book L пока нет сборщика тенниса - пропускаем, а не падаем на отсутствующем файле
  if [ "$TENNIS_ON" = "true" ] && [ -f "sync-${slug}-tennis.ts" ]; then
    run_job "$slug-tennis" npx tsx "sync-$slug-tennis.ts"
    ( flock 202; node dedupe-tennis.js >> "$LOG" 2>&1 ) 202>/tmp/odds-dedupe-tennis.lock
  fi
}

BOOKS="booka bookb bookc bookd"
echo "=== $(date -u '+%F %T') надсмотрщик запущен: у каждой конторы свой интервал (sync-config.json prematchIntervals) ===" >> "$LOG"
while :; do
  eval "$(node read-sync-config.js)"
  if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 10485760 ]; then
    mv "$LOG" "$LOG.old"
  fi
  now=$(date +%s)
  force=$(cat "$FORCE_FILE" 2>/dev/null || echo 0)
  for slug in $BOOKS; do
    up=${slug^^}
    on_var="BK_${up}_ON"; int_var="BK_${up}_INT"
    [ "${!on_var}" = "true" ] || continue
    int="${!int_var}"
    [ -n "$int" ] || int="$FAST_INTERVAL"
    last=$(cat "/tmp/odds-sync-bk-$slug.last" 2>/dev/null || echo 0)
    if [ $((now - last)) -ge "${int:-0}" ] || [ "$force" -gt "$last" ]; then
      chain "$slug" &
      disown
    fi
  done
  sleep 5
done
