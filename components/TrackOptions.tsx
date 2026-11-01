"use client";

import { type ReactNode } from "react";
import { LIVE_DETAIL_LEVEL_CONFIG, type LiveDetailLevel } from "@/lib/liveAdapters";

export function DetailLevelList({ level }: { level: LiveDetailLevel; onChange?: (l: LiveDetailLevel) => void }) {
  const cfg = LIVE_DETAIL_LEVEL_CONFIG[level] ?? LIVE_DETAIL_LEVEL_CONFIG.MODERATE;
  return (
    <div className="dl-fixed">
      <span className="dl-fixed-name">{cfg.label}</span>
      <span className="dl-fixed-meta">проверка каждые {cfg.pollIntervalSec} сек</span>
    </div>
  );
}

export function BookmakerFold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <div className="bm-fold">
      <div className="bm-fold-head">
        <div className="section-heading" style={{ margin: 0 }}>Букмекеры</div>
        <div className="bm-fold-sum">{summary}</div>
      </div>
      <div className="bm-fold-body">{children}</div>
    </div>
  );
}
