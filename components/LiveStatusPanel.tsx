"use client";

import { useEffect, useState } from "react";
import Loader from "./Loader";

// Панель «Парсинг» (состояние движка Live-трекера по букмекерам)
interface LiveStatusBookmaker {
  slug: string;
  name: string;
  ready: boolean;
  trackedMatches: number;
  totalEvents: number;
  lastEventAt: string | null;
}

interface LiveStatus {
  serviceActive: boolean;
  proc: { cpuPercent: number; memMb: number } | null;
  counts: { scheduled: number; tracking: number; finished: number; failed: number };
  bookmakers: LiveStatusBookmaker[];
  serverTime: string;
}

function formatAgo(iso: string | null): string {
  if (!iso) return "никогда";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч ${min % 60} мин назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн ${hours % 24} ч назад`;
}

function LiveStatusPanel({ data }: { data: LiveStatus | null }) {
  if (!data) {
    return (
      <div className="market-placeholder">
        <Loader label="Загрузка статуса…" size={105} />
      </div>
    );
  }

  const activeTotal = data.counts.scheduled + data.counts.tracking;

  return (
    <div className="live-status-panel">
      <div className="live-status-summary">
        <div className="live-status-card">
          <div className="live-status-card-label">
            <span className="msi">bolt</span> Движок опроса
          </div>
          <div className={`live-status-card-value${data.serviceActive ? " live-status-card-value-good" : " live-status-card-value-bad"}`}>
            {data.serviceActive ? "работает" : "остановлен"}
          </div>
          <div className="live-status-card-sub">
            {data.proc ? `${data.proc.cpuPercent.toFixed(1)}% CPU · ${data.proc.memMb} МБ` : "процесс не найден"}
          </div>
        </div>
        <div className="live-status-card">
          <div className="live-status-card-label">
            <span className="msi">sensors</span> Активно сейчас
          </div>
          <div className="live-status-card-value">{activeTotal}</div>
          <div className="live-status-card-sub">
            {data.counts.tracking} идут live · {data.counts.scheduled} ждут начала
          </div>
        </div>
        <div className="live-status-card">
          <div className="live-status-card-label">
            <span className="msi">history</span> Завершено
          </div>
          <div className="live-status-card-value">{data.counts.finished}</div>
          <div className="live-status-card-sub">{data.counts.failed} неудачных</div>
        </div>
      </div>

      <div className="section-heading">Конторы</div>
      <div className="live-status-table-wrap">
        <table className="live-status-table">
          <thead>
            <tr>
              <th>Контора</th>
              <th>Live-адаптер</th>
              <th>Матчей отслежено</th>
              <th>Записей кэфа</th>
              <th>Последняя запись</th>
            </tr>
          </thead>
          <tbody>
            {data.bookmakers.map((b) => (
              <tr key={b.slug}>
                <td className="lst-name">{b.name}</td>
                <td data-label="Live-адаптер">
                  <span className={`live-badge ${b.ready ? "live-badge-done" : "live-badge-fail"}`}>{b.ready ? "готово" : "не готово"}</span>
                </td>
                <td data-label="Матчей отслежено">{b.ready ? b.trackedMatches : "—"}</td>
                <td data-label="Записей кэфа">{b.ready ? b.totalEvents : "—"}</td>
                <td data-label="Последняя запись">{b.ready ? formatAgo(b.lastEventAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LiveStatusTab() {
  const [data, setData] = useState<LiveStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/live-status");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // повторим на следующем тике
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  return <LiveStatusPanel data={data} />;
}
