#!/bin/bash
BETMARK_HOME="${BETMARK_HOME:-$(cd "$(dirname "$0")" && pwd)}"; export BETMARK_HOME
# ИИ-проверка дублей матчей по названиям - раз в 30 минут (odds-ai-dedup.timer)
cd $BETMARK_HOME || exit 1
npx tsx ai-dedup.ts
