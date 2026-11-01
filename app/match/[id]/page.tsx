"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import SiteHeader from "../../../components/SiteHeader";
import Loader from "../../../components/Loader";
import { compareBookmakerSlugs } from "../../../lib/bookmakerOrder";

interface HistoryPoint {
  outcome: "1" | "X" | "2";
  price: number;
  capturedAt: string;
}

interface BookmakerDetail {
  slug: string;
  name: string;
  externalId: string;
  sourceUrl: string | null;
  rawHomeTeam: string;
  rawAwayTeam: string;
  odds: { "1": number | null; X: number | null; "2": number | null };
  history: HistoryPoint[];
}

const BOOKMAKER_FALLBACK_URL: Record<string, string> = {
  booka: "https://example.com",
  bookb: "https://example.com",
  bookc: "https://example.com",
  bookd: "https://example.com",
  booke: "https://example.com",
  bookf: "https://example.com",
  bookh: "https://example.com",
  booki: "https://example.com",
  bookj: "https://example.com",
  bookg: "https://example.com",
};

function buildBookmakerUrl(slug: string, sourceUrl: string | null): string {
  return sourceUrl || BOOKMAKER_FALLBACK_URL[slug] || "#";
}

const MARKET_TABS = [
  { value: "1x2", label: "1X2 · Полное время" },
  { value: "totals", label: "Тоталы" },
  { value: "handicap", label: "Форы" },
  { value: "btts", label: "Обе забьют" },
] as const;

interface MatchDetail {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  league: string;
  bookmakers: BookmakerDetail[];
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function payoutPercent(bm: BookmakerDetail): string | null {
  const { "1": p1, X: pX, "2": p2 } = bm.odds;
  if (p1 === null || pX === null || p2 === null) return null;
  const overround = 1 / p1 + 1 / pX + 1 / p2;
  return (100 / overround).toFixed(1);
}

function trend(bm: BookmakerDetail, outcome: "1" | "X" | "2"): "up" | "down" | null {
  const cur = bm.odds[outcome];
  if (cur === null) return null;
  const sameOutcome = bm.history.filter((h) => h.outcome === outcome);
  if (sameOutcome.length < 2) return null;
  const prev = sameOutcome[1].price;
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const [data, setData] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [activeMarket, setActiveMarket] = useState<string>("1x2");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/matches/${id}`);
        if (res.status === 404) {
          if (!cancelled) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }
        if (res.status === 403) {
          if (!cancelled) {
            setForbidden(true);
            setLoading(false);
          }
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  const best: Record<string, number> = { "1": -Infinity, X: -Infinity, "2": -Infinity };
  if (data) {
    for (const bm of data.bookmakers) {
      for (const outcome of ["1", "X", "2"] as const) {
        const v = bm.odds[outcome];
        if (v !== null && v > best[outcome]) best[outcome] = v;
      }
    }
  }

  // "Вилка" - если взять ЛУЧШИЙ кэф по каждому исходу отдельно (не обязательно у одной конторы)
  const hasAllBest =
    Number.isFinite(best["1"]) && Number.isFinite(best.X) && Number.isFinite(best["2"]);
  const bestPayout = hasAllBest
    ? 100 / (1 / best["1"] + 1 / best.X + 1 / best["2"])
    : null;

  return (
    <>
      <header className="header">
        <SiteHeader />
      </header>

      <main className="main">
        <Link href="/board" className="back-link">
          <span className="msi" style={{ fontSize: 18 }}>
            arrow_back
          </span>
          Ко всем матчам
        </Link>

        {loading && <Loader label="Загрузка матча…" />}
        {notFound && <div className="page-subtitle">Матч не найден</div>}
        {forbidden && <div className="page-subtitle">У вашего аккаунта нет доступа к этому разделу.</div>}

        {data && (
          <>
            <div className="match-header">
              <h1 className="match-header-title">
                {data.homeTeam} — {data.awayTeam}
              </h1>
              <div className="match-header-meta">
                {data.league} · {formatDateTime(data.kickoffAt)}
              </div>
            </div>

            <div className="view-tabs market-tabs">
              {MARKET_TABS.map((mt) => (
                <button
                  key={mt.value}
                  type="button"
                  className={`view-tab${activeMarket === mt.value ? " view-tab-active" : ""}`}
                  onClick={() => setActiveMarket(mt.value)}
                >
                  {mt.label}
                </button>
              ))}
            </div>

            {activeMarket !== "1x2" && (
              <div className="market-placeholder">
                Данные по этому рынку пока не собираются — сейчас отслеживается
                только 1X2 (победа/ничья/победа).
              </div>
            )}

            {activeMarket === "1x2" && (
              <div className="table-wrap">
                <table className="odds-table match-odds-table">
                  <thead>
                    <tr>
                      <th className="col-league">Контора</th>
                      <th className="col-bookmaker">П1</th>
                      <th className="col-bookmaker">X</th>
                      <th className="col-bookmaker">П2</th>
                      <th className="col-bookmaker">Payout %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.bookmakers].sort((a, b) => compareBookmakerSlugs(a.slug, b.slug)).map((bm) => {
                      const payout = payoutPercent(bm);
                      const url = buildBookmakerUrl(bm.slug, bm.sourceUrl);
                      return (
                        <tr key={bm.slug}>
                          <td className="col-league" style={{ color: "var(--text)", fontWeight: 500 }}>
                            {bm.name}
                          </td>
                          {(["1", "X", "2"] as const).map((outcome) => {
                            const v = bm.odds[outcome];
                            const isBest = v !== null && v === best[outcome];
                            const t = trend(bm, outcome);
                            return (
                              <td key={outcome} className="col-bookmaker" data-label={outcome === "1" ? "П1" : outcome === "X" ? "X" : "П2"}>
                                {v !== null ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`odds-value odds-value-link${isBest ? " odds-best" : ""}`}
                                    title={`Открыть на сайте ${bm.name}`}
                                  >
                                    {v.toFixed(2)}
                                    {t && (
                                      <span className={`msi trend-icon trend-${t}`}>
                                        {t === "up" ? "arrow_drop_up" : "arrow_drop_down"}
                                      </span>
                                    )}
                                  </a>
                                ) : (
                                  <span className="odds-empty">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="col-bookmaker payout-cell" data-label="Payout %">{payout !== null ? `${payout}%` : "—"}</td>
                        </tr>
                      );
                    })}
                    {data.bookmakers.length === 0 && (
                      <tr>
                        <td className="empty-row" colSpan={5}>
                          Нет данных ни от одной конторы
                        </td>
                      </tr>
                    )}
                    {hasAllBest && data.bookmakers.length > 1 && (
                      <tr className="best-combo-row">
                        <td style={{ fontWeight: 500 }}>Лучшая комбинация</td>
                        <td className="col-bookmaker" data-label="П1">{best["1"].toFixed(2)}</td>
                        <td className="col-bookmaker" data-label="X">{best.X.toFixed(2)}</td>
                        <td className="col-bookmaker" data-label="П2">{best["2"].toFixed(2)}</td>
                        <td className="col-bookmaker payout-cell" data-label="Payout %">
                          {bestPayout !== null ? `${bestPayout.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {hasAllBest && data.bookmakers.length > 1 && bestPayout !== null && bestPayout > 100 && (
              <div className="page-subtitle" style={{ marginTop: 8 }}>
                Формальная "вилка" — если поставить на все 3 исхода в
                правильной пропорции у разных контор (лучший кэф по каждому
                исходу), совокупный payout {bestPayout.toFixed(1)}% — теоретически
                гарантированный доход без учёта лимитов ставок и комиссий.
              </div>
            )}

            <h2 className="section-heading">История коэффициентов</h2>
            {data.bookmakers.every((bm) => bm.history.length <= 3) && (
              <div className="page-subtitle" style={{ marginBottom: 12 }}>
                История ещё короткая — накапливается при каждом обновлении данных.
              </div>
            )}
            {[...data.bookmakers].sort((a, b) => compareBookmakerSlugs(a.slug, b.slug)).map((bm) => {
              const minuteBucket = (iso: string) => Math.floor(new Date(iso).getTime() / 60000);
              const groups: { time: string; points: HistoryPoint[] }[] = [];
              let lastBucket: number | null = null;
              for (const h of bm.history) {
                const bucket = minuteBucket(h.capturedAt);
                const last = groups[groups.length - 1];
                if (last && lastBucket === bucket) {
                  last.points.push(h);
                } else {
                  groups.push({ time: h.capturedAt, points: [h] });
                  lastBucket = bucket;
                }
              }

              return (
                <div key={bm.slug} className="history-block">
                  <div className="history-title">{bm.name}</div>
                  <div className="table-wrap">
                    <table className="odds-table">
                      <thead>
                        <tr>
                          <th className="col-outcome">Исход</th>
                          <th className="col-bookmaker">Коэффициент</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => (
                          <>
                            <tr key={g.time} className="history-time-row">
                              <td colSpan={2}>{formatTime(g.time)}</td>
                            </tr>
                            {g.points.map((h, i) => (
                              <tr key={`${g.time}-${i}`}>
                                <td className="col-outcome">
                                  {h.outcome === "1" ? "П1" : h.outcome === "2" ? "П2" : "X"}
                                </td>
                                <td className="col-bookmaker">{h.price.toFixed(2)}</td>
                              </tr>
                            ))}
                          </>
                        ))}
                        {bm.history.length === 0 && (
                          <tr>
                            <td className="empty-row" colSpan={2}>
                              Пока нет данных
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </main>

      <footer className="footer">
        Данные собираются автоматически, обновление каждые 30 секунд
      </footer>
    </>
  );
}
