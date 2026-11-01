#!/bin/bash
BETMARK_HOME="${BETMARK_HOME:-$(cd "$(dirname "$0")" && pwd)}"; export BETMARK_HOME
# Проверка "двойного расписания" (одна команда - два матча почти одновременно)
cd $BETMARK_HOME || exit 1
npx tsx check-odds-anomalies.ts
