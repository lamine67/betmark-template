#!/bin/bash
BETMARK_HOME="${BETMARK_HOME:-$(cd "$(dirname "$0")" && pwd)}"; export BETMARK_HOME
# Раз в сутки (odds-archive.timer, история кэфов
set -euo pipefail
cd $BETMARK_HOME
set -a; . ./.env; set +a
DB=$(echo "$DATABASE_URL" | sed 's#.*/##; s#?.*##')
mkdir -p /root/odds-archive
OUT=/root/odds-archive/snapshots-$(date -u +%Y%m%d-%H%M).csv.gz
psqlq() { su postgres -c "psql -d $DB -At -v ON_ERROR_STOP=1"; }
# фиксируем границу один раз, чтобы выгрузка и удаление взяли одни и те же строки
CUT=$(echo "select to_char(now()-interval '30 days','YYYY-MM-DD HH24:MI:SS')" | psqlq)
WHERE="s.\"capturedAt\" < '$CUT' and exists (select 1 from \"BookmakerMatch\" bm join \"Match\" m on m.id=bm.\"matchId\" where bm.id=s.\"bookmakerMatchId\" and m.\"kickoffAt\" < '$CUT')"
echo "\copy (select s.* from \"OddsSnapshot\" s where $WHERE) to stdout with csv" | psqlq | gzip > "$OUT.part"
ROWS=$(gunzip -c "$OUT.part" | wc -l)
mv "$OUT.part" "$OUT"
DEL=0
if [ "$ROWS" -gt 0 ]; then
  DEL=$(echo "with d as (delete from \"OddsSnapshot\" s where $WHERE returning 1) select count(*) from d" | psqlq)
else
  rm -f "$OUT"
fi
echo "$(date -u '+%F %T') archive: saved $ROWS rows to $OUT, deleted $DEL" >> $BETMARK_HOME/archive.log
[ "$ROWS" = "$DEL" ] || echo "[$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')] !!! архив кэфов: выгружено $ROWS, удалено $DEL" >> $BETMARK_HOME/anomalies.log
echo "saved=$ROWS deleted=$DEL file=$OUT"
