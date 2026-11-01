"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCardsPref, VIEW_PREFS_EVENT } from "../../lib/viewPrefs";
import Link from "next/link";
import { isTopLeague, topLeagueKey, TOP_LEAGUE_NAMES, isExcludedLeague, isWomenMatch } from "../../lib/topLeagues";
import { isTopTennisTournament, topTennisKey, TOP_TENNIS_NAMES } from "../../lib/topTennis";
import { isTopHockeyLeague, topHockeyKey, TOP_HOCKEY_NAMES, isFakeNhlMatch } from "../../lib/topHockey";
import SiteHeader from "../../components/SiteHeader";
import Loader from "../../components/Loader";
import SurebetCalculatorModal from "../../components/SurebetCalculatorModal";
import { compareBookmakerSlugs } from "../../lib/bookmakerOrder";
import { MATCH_TAGS, DEFAULT_HIDDEN_TAGS, DEFAULT_MIN_BOOKS, isHiddenByQuality, booksWithOdds, normalizeBoardPrefs, type MatchTag } from "../../lib/matchQuality";
import { useBetmarkPerms } from "../../lib/useBetmarkPerms";

type SportSlug = "football" | "tennis" | "hockey";

// Диспетчер классификатора "топ-турнир" по текущему виду спорта
function isTopForSport(name: string, sport: SportSlug): boolean {
  if (sport === "tennis") return isTopTennisTournament(name);
  if (sport === "hockey") return isTopHockeyLeague(name);
  return isTopLeague(name);
}
function topKeyForSport(name: string, sport: SportSlug): string | null {
  if (sport === "tennis") return topTennisKey(name);
  if (sport === "hockey") return topHockeyKey(name);
  return topLeagueKey(name);
}
function topNamesForSport(sport: SportSlug): string[] {
  if (sport === "tennis") return TOP_TENNIS_NAMES;
  if (sport === "hockey") return TOP_HOCKEY_NAMES;
  return TOP_LEAGUE_NAMES;
}

interface BookmakerOdds {
  slug: string;
  name: string;
  externalId: string;
  sourceUrl: string | null;
  odds: { "1": number | null; X: number | null; "2": number | null };
}

// Прямая ссылка на сайт конторы
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

function LeagueMultiSelect({
  options,
  selected,
  onChange,
  onOpen,
}: {
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  }

  const triggerLabel =
    selected.size === 0 ? "Не выбрано" : `Выбрано лиг: ${selected.size}`;

  return (
    <div className="custom-select" ref={ref}>
      <button
        type="button"
        className={`custom-select-trigger${open ? " custom-select-trigger-open" : ""}`}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span className="custom-select-value">{triggerLabel}</span>
        <span className="msi custom-select-arrow">expand_more</span>
      </button>
      {open && (
        <div className="custom-select-panel">
          <input
            type="text"
            className="custom-select-search"
            placeholder="Поиск лиги…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="custom-select-list">
            {filtered.map((name) => (
              <label key={name} className="custom-select-checkbox-option">
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => toggle(name)}
                />
                <span>{name}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="custom-select-empty">Ничего не найдено</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface MatchRow {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  league: string;
  bookmakerCount: number;
  bookmakers: BookmakerOdds[];
  topLeagueFlagged: boolean;
  regularCount?: number; // разных свежих обычных контор (правило "минимум 2", lib/regularBooks.ts)
  topLeagueReviewAnswer: boolean | null;
}

const TIME_WINDOWS = [
  { value: "3", label: "3 часа" },
  { value: "6", label: "6 часов" },
  { value: "12", label: "12 часов" },
  { value: "24", label: "24 часа" },
  { value: "48", label: "48 часов" },
  { value: "all", label: "Все" },
] as const;

// Payout по лучшим кэфам СРЕДИ ВИДИМЫХ контор (та же логика, что и в самой ячейке Payout% таблицы, MatchGroup)
function matchPayout(m: MatchRow, visibleSlugs: Set<string>): number | null {
  const best: Record<"1" | "X" | "2", number> = { "1": -Infinity, X: -Infinity, "2": -Infinity };
  for (const bm of m.bookmakers) {
    if (!visibleSlugs.has(bm.slug)) continue;
    for (const outcome of ["1", "X", "2"] as const) {
      const v = bm.odds[outcome];
      if (v !== null && v > best[outcome]) best[outcome] = v;
    }
  }
  if (!Number.isFinite(best["1"]) || !Number.isFinite(best["2"])) return null;
  let sum = 1 / best["1"] + 1 / best["2"];
  if (Number.isFinite(best.X)) sum += 1 / best.X;
  return 100 / sum;
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Сегодня, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Завтра, ${time}`;
  return `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}, ${time}`;
}

// Порог "свежести" синка конторы - тот же, что и /status использует для бейджа "Актуально"/"Задержка" (20 минут)
const FRESHNESS_THRESHOLD_MS = 20 * 60 * 1000;

function emptyCellLabel(freshnessIso: string | null | undefined): { title: string; caption: string } {
  if (!freshnessIso) return { title: "Нет данных от этого букмекера", caption: "нет данных" };
  const ageMs = Date.now() - new Date(freshnessIso).getTime();
  if (ageMs < FRESHNESS_THRESHOLD_MS) {
    return { title: "Линия букмекера недавно обновлена — котировки на этот матч у него отсутствуют", caption: "нет в БК" };
  }
  const minutes = Math.round(ageMs / 60000);
  return {
    title: `Данные букмекера не обновлялись ${minutes} мин. — возможно, котировки временно недоступны при сканировании`,
    caption: "нет данных",
  };
}

function MatchGroup({
  league,
  matches,
  visibleBookmakers,
  colSpan,
  showLeagueColumn,
  sportSlug,
  bookmakerFreshness,
  onOpenCalculator,
  onDelete,
}: {
  league?: string;
  matches: MatchRow[];
  visibleBookmakers: { slug: string; name: string }[];
  colSpan: number;
  showLeagueColumn: boolean;
  sportSlug: SportSlug;
  bookmakerFreshness: Record<string, string | null>;
  onOpenCalculator: (match: MatchRow) => void;
  onDelete?: (match: MatchRow) => void;
}) {
  const outcomes = sportSlug === "tennis" ? (["1", "2"] as const) : (["1", "X", "2"] as const);
  return (
    <>
      {league && (
        <tr className="league-header-row">
          <td colSpan={colSpan}>
            <span className="msi league-header-icon">
              {sportSlug === "tennis" ? "sports_tennis" : sportSlug === "hockey" ? "sports_hockey" : "sports_soccer"}
            </span>
            {league}
          </td>
        </tr>
      )}
      {matches.map((m) => {
        const visibleSlugs = new Set(visibleBookmakers.map((b) => b.slug));
        const best: Record<string, number> = {};
        for (const outcome of outcomes) {
          let max = -Infinity;
          for (const b of m.bookmakers) {
            if (!visibleSlugs.has(b.slug)) continue;
            const v = b.odds[outcome];
            if (v !== null && v > max) max = v;
          }
          best[outcome] = max;
        }
        const hasAllBest = outcomes.every((o) => Number.isFinite(best[o]));
        const payoutValue = hasAllBest
          ? 100 / outcomes.reduce((sum, o) => sum + 1 / best[o], 0)
          : null;
        const isArb = payoutValue !== null && payoutValue > 100 && m.bookmakerCount > 1;
        return (
          <Fragment key={m.id}>
            <tr className="desktop-match-row">
              <td className="col-match">
                <Link href={`/match/${m.id}`} className="match-link">
                  <div className="team">{m.homeTeam}</div>
                  <div className="team">{m.awayTeam}</div>
                </Link>
              </td>
              {showLeagueColumn && <td className="col-league">{m.league}</td>}
              <td className="col-time">{formatKickoff(m.kickoffAt)}</td>
              {visibleBookmakers.map((bk) => {
                const bm = m.bookmakers.find((b) => b.slug === bk.slug);
                return (
                  <td key={bk.slug} className="col-bookmaker">
                    {bm ? (
                      <a
                        href={buildBookmakerUrl(bm.slug, bm.sourceUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="odds-link"
                        title={`Открыть на сайте ${bm.name}`}
                      >
                        <div className="odds-triplet">
                          {outcomes.map((outcome) => {
                            const v = bm.odds[outcome];
                            const isBest = v !== null && v === best[outcome] && m.bookmakerCount > 1;
                            return (
                              <span
                                key={outcome}
                                className={`odds-value${isBest ? " odds-best" : ""}${isBest && isArb ? " odds-arb" : ""}`}
                              >
                                {v !== null ? v.toFixed(2) : "—"}
                              </span>
                            );
                          })}
                        </div>
                      </a>
                    ) : (
                      (() => {
                        const { title, caption } = emptyCellLabel(bookmakerFreshness[bk.slug]);
                        return (
                          <span className="odds-empty" title={title}>
                            —{caption && <span className="odds-empty-caption">{caption}</span>}
                          </span>
                        );
                      })()
                    )}
                  </td>
                );
              })}
              <td className={`col-payout${isArb ? " col-payout-arb" : ""}`}>
                {/* Одна строка всегда: значение + два слота под иконки фиксированной ширины "всё должно быть по сетке и одинаково") */}
                <div className="payout-cell">
                  <span className="payout-value">{payoutValue !== null ? `${payoutValue.toFixed(1)}%` : "—"}</span>
                  <span className="payout-actions">
                    {m.bookmakerCount > 1 ? (
                      <button
                        type="button"
                        className="calc-arb-btn"
                        onClick={() => onOpenCalculator(m)}
                        title="Рассчитать вилку"
                        aria-label="Рассчитать вилку"
                      >
                        <span className="msi">calculate</span>
                      </button>
                    ) : (
                      <span className="payout-slot" aria-hidden="true" />
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="calc-arb-btn delete-match-btn"
                        onClick={() => onDelete(m)}
                        title="Удалить матч"
                        aria-label="Удалить матч"
                      >
                        <span className="msi">delete</span>
                      </button>
                    )}
                  </span>
                </div>
              </td>
            </tr>

            <tr className="mobile-match-row">
              <td className="mobile-match-card-cell" colSpan={colSpan}>
                <div className="mobile-match-card">
                  <Link href={`/match/${m.id}`} className="mobile-match-header">
                    <div className="mobile-match-teams">
                      <div className="team">{m.homeTeam}</div>
                      <div className="team">{m.awayTeam}</div>
                      {showLeagueColumn && <div className="mobile-match-league">{m.league}</div>}
                    </div>
                    <div className="mobile-match-meta">
                      <span className="mobile-match-time">{formatKickoff(m.kickoffAt)}</span>
                      <span className={`mobile-match-payout${isArb ? " col-payout-arb" : ""}`}>
                        {payoutValue !== null ? `${payoutValue.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </Link>
                  <div className="mobile-match-actions">
                    {m.bookmakerCount > 1 && (
                      <button
                        type="button"
                        className="calc-arb-btn calc-arb-btn-mobile"
                        onClick={() => onOpenCalculator(m)}
                        title="Рассчитать вилку"
                      >
                        <span className="msi">calculate</span>
                        Вилка
                      </button>
                    )}
                    {onDelete && (
                      <button type="button" className="delete-match-btn-mobile" onClick={() => onDelete(m)} aria-label="Удалить матч">
                        <span className="msi">delete</span>
                        Удалить
                      </button>
                    )}
                  </div>
                  <div className="mobile-bookmaker-list">
                    {visibleBookmakers.map((bk) => {
                      const bm = m.bookmakers.find((b) => b.slug === bk.slug);
                      return (
                        <div key={bk.slug} className="mobile-bookmaker-row">
                          <span className="mobile-bookmaker-name">{bk.name}</span>
                          {bm ? (
                            <a
                              href={buildBookmakerUrl(bm.slug, bm.sourceUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="mobile-odds-triplet"
                            >
                              {outcomes.map((outcome) => {
                                const v = bm.odds[outcome];
                                const isBest = v !== null && v === best[outcome] && m.bookmakerCount > 1;
                                return (
                                  <span
                                    key={outcome}
                                    className={`odds-value${isBest ? " odds-best" : ""}${isBest && isArb ? " odds-arb" : ""}`}
                                  >
                                    {v !== null ? v.toFixed(2) : "—"}
                                  </span>
                                );
                              })}
                            </a>
                          ) : (
                            (() => {
                              const { title, caption } = emptyCellLabel(bookmakerFreshness[bk.slug]);
                              return (
                                <span className="odds-empty mobile-odds-empty" title={title}>
                                  —{caption && <span className="odds-empty-caption">{caption}</span>}
                                </span>
                              );
                            })()
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </td>
            </tr>
          </Fragment>
        );
      })}
    </>
  );
}

export default function Home() {
  const [sportSlug, setSportSlug] = useState<SportSlug>("football");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [calcMatch, setCalcMatch] = useState<MatchRow | null>(null);
  // Удаление матча окно выбора "только у этого аккаунта / у всех", панель "Отменить" сразу после удаления
  const { perms: myPerms } = useBetmarkPerms();
  const [deleteMatch, setDeleteMatch] = useState<MatchRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [undoInfo, setUndoInfo] = useState<{ match: MatchRow; scope: "me" | "all" } | null>(null);

  async function confirmDelete(scope: "me" | "all") {
    if (!deleteMatch) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/matches/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: deleteMatch.id, scope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || "Не удалось удалить матч");
        return;
      }
      const removed = deleteMatch;
      setMatches((prev) => prev.filter((x) => x.id !== removed.id));
      setUndoInfo({ match: removed, scope });
      setDeleteMatch(null);
    } catch {
      setDeleteError("Нет соединения с сервером");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function undoDelete() {
    if (!undoInfo) return;
    const { match, scope } = undoInfo;
    setUndoInfo(null);
    try {
      const res = await fetch("/api/matches/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, scope, restore: true }),
      });
      if (res.ok) {
        setMatches((prev) =>
          prev.some((x) => x.id === match.id)
            ? prev
            : [...prev, match].sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())
        );
      }
    } catch {
      // не вышло отменить - матч можно вернуть, перезагрузив страницу (для "только у меня") или через администратора
    }
  }

  useEffect(() => {
    if (!undoInfo) return;
    const t = setTimeout(() => setUndoInfo(null), 12000);
    return () => clearTimeout(t);
  }, [undoInfo]);
  // "Пустой" калькулятор вилки без привязки к матчу
  const [calcStandaloneOpen, setCalcStandaloneOpen] = useState(false);
  // "Помогите Betmark" - квиз "это топ-лига?" для матчей, которых ИИ-проверка сочла подозрительными
  const [helpQuizOpen, setHelpQuizOpen] = useState(false);
  const [reviewRemaining, setReviewRemaining] = useState(0);
  // Свежесть последнего синка каждой конторы ПО ЭТОМУ виду спорта
  const [bookmakerFreshness, setBookmakerFreshness] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  // Нет права board_view - показываем вместо таблицы сообщение об отсутствии доступа, а не пустую/сломанную страницу
  const [forbidden, setForbidden] = useState(false);
  // вместо галочки "Только со сравнением (2+)"
  const [minBooks, setMinBooks] = useState<number>(DEFAULT_MIN_BOOKS);
  const [hiddenTags, setHiddenTags] = useState<Set<MatchTag>>(new Set(DEFAULT_HIDDEN_TAGS));
  const boardPrefsLoadedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [timeWindow, setTimeWindow] = useState<string>("12");
  const [leagueMode, setLeagueMode] = useState<"top" | "all" | "custom">("top");
  const [customLeagues, setCustomLeagues] = useState<Set<string>>(new Set());
  const [excludedTopKeys, setExcludedTopKeys] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<string>("kickoff");
  const [hiddenBookmakers, setHiddenBookmakers] = useState<Set<string>>(new Set());
  // Какие конторы скрыты по умолчанию - настраивается на /status
  const [defaultHiddenBookmakers, setDefaultHiddenBookmakers] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sync-config")
      .then((r) => r.json())
      .then((cfg) => {
        if (cancelled) return;
        const hidden: string[] = Array.isArray(cfg?.defaultHiddenBookmakers) ? cfg.defaultHiddenBookmakers : [];
        setDefaultHiddenBookmakers(hidden);
        setHiddenBookmakers(new Set(hidden));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [viewMode, setViewMode] = useState<"league" | "time">("league");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [allRequested, setAllRequested] = useState(false);
  const needAllLeagues = leagueMode === "all" || allRequested || (leagueMode === "custom" && [...customLeagues].some((l) => !isTopForSport(l, sportSlug)));
  const prevSportRef = useRef<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const sportChanged = prevSportRef.current !== sportSlug;
    prevSportRef.current = sportSlug;
    if (sportChanged) setLoading(true);
    else setLoadingAll(needAllLeagues);
    async function load() {
      try {
        const res = await fetch(`/api/matches?sport=${sportSlug}${needAllLeagues ? "" : "&topOnly=1"}`);
        if (res.status === 403) {
          if (!cancelled) {
            setForbidden(true);
            setLoading(false);
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setMatches(data.matches);
          setBookmakerFreshness(data.bookmakerFreshness ?? {});
          setLoading(false);
          setLoadingAll(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
          setLoadingAll(false);
        }
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sportSlug, needAllLeagues]);

  // "Помогите Betmark" - сколько неотвеченных вопросов сейчас есть
  const loadReviewRemaining = useCallback(async () => {
    try {
      const res = await fetch(`/api/top-league-review`);
      if (!res.ok) return;
      const data = await res.json();
      setReviewRemaining(data.remaining ?? 0);
    } catch {
      // молча - кнопка просто не появится/не обновится в этот раз
    }
  }, []);

  useEffect(() => {
    loadReviewRemaining();
    const interval = setInterval(loadReviewRemaining, 30000);
    return () => clearInterval(interval);
  }, [loadReviewRemaining]);

  const bookmakerSlugs = useMemo(() => {
    // порядок контор - единый и фиксированный для всех видов спорта (lib/bookmakerOrder.ts), Book Q первым
    const names: Record<string, string> = {};
    for (const m of matches) {
      for (const b of m.bookmakers) names[b.slug] = b.name;
    }
    const present = Object.keys(names);
    present.sort(compareBookmakerSlugs);
    return present.map((slug) => ({ slug, name: names[slug] }));
  }, [matches]);

  const leagues = useMemo(() => {
    const base =
      sportSlug === "football"
        ? matches.filter((m) => !isWomenMatch(m) && !isExcludedLeague(m.league))
        : sportSlug === "hockey"
          ? matches.filter((m) => !isFakeNhlMatch(m))
          : matches;
    const set = new Set(base.map((m) => m.league));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [matches, sportSlug]);

  const visibleBookmakers = useMemo(
    () => bookmakerSlugs.filter((b) => !hiddenBookmakers.has(b.slug)),
    [bookmakerSlugs, hiddenBookmakers]
  );

  const [filtersPanelHidden, setFiltersPanelHidden] = useState(false);
  // Ручное скрытие боковой панели «сделай чтобы можно было боковую панель скрыть вручную кнопкой»)
  const [panelManualHidden, setPanelManualHidden] = useState(false);
  useEffect(() => {
    try {
      setPanelManualHidden(localStorage.getItem("board.panelHidden") === "1");
    } catch {
      /* память браузера недоступна - панель просто остаётся видимой */
    }
  }, []);
  function changePanelManualHidden(v: boolean) {
    setPanelManualHidden(v);
    try {
      localStorage.setItem("board.panelHidden", v ? "1" : "0");
    } catch {
      /* не критично */
    }
  }
  const [cardLayout, setCardLayout] = useState(false);
  // Масштаб таблицы 0.64..1 при многих конторах шрифт кэфов
  const [tableScale, setTableScale] = useState(1);
  // Добор масштаба по факту (множитель <=1): формула по зонду не учитывает несжимаемые части
  const [fitShrink, setFitShrink] = useState(1);
  const [fitTick, setFitTick] = useState(0);
  const effectiveScale = Math.abs(tableScale - 1) < 0.001 ? 1 : Math.max(0.64, tableScale * fitShrink);
  const tableProbeRef = useRef<HTMLTableElement>(null);
  const [scaleReady, setScaleReady] = useState(false);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  useEffect(() => {
    if (loading) setScaleReady(false);
  }, [loading]);

  useEffect(() => {
    function recompute() {
      const probeRowCount = tableProbeRef.current?.querySelectorAll("tbody tr").length ?? 0;
      if (loadingRef.current || (probeRowCount === 0 && window.innerWidth > 700 && !tableProbeRef.current?.scrollWidth)) {
        // данных нет: пока грузится - ничего не считаем; загрузилось пусто («Ничего не найдено») - обычный масштаб
        setCardLayout(window.innerWidth <= 700);
        if (!loadingRef.current) {
          setTableScale(1);
          setScaleReady(true);
        }
        return;
      }
      const pageX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--page-x")) || 32;
      const MAIN_PADDING = pageX * 2; // .main padding-left+right = две сетки полей (--page-x)
      const PANEL_WIDTH = 240; // .filters-panel (220) + gap (20)
      const probeWidth = tableProbeRef.current?.scrollWidth ?? 0;
      // Пока зонд ещё не отрисовался (первый кадр)
      const tableMinWidth = probeWidth > 0 ? probeWidth : 900;
      // Формат (таблица или карточки) не должен зависеть от режима «По лигам / По времени»
      const leagueColW = viewMode === "time" ? tableProbeRef.current?.querySelector("th.col-league")?.getBoundingClientRect().width ?? 0 : 0;
      const formatMinWidth = Math.max(1, tableMinWidth - leagueColW);
      const clientW = document.documentElement.clientWidth || window.innerWidth; // без вертикального скроллбара
      const MIN_K = 0.72; // ниже шрифт кэфов <9px - нечитаемо: вместо этого включаются карточки
      const MAX_K = 2; // когда места больше, чем нужно, кэфы и вся таблица РАСТУТ (до 2×), строка матча при этом остаётся одной
      const kWithPanel = (clientW - MAIN_PADDING - PANEL_WIDTH - 2) / formatMinWidth;
      const hidePanel = panelManualHidden || kWithPanel < 0.8;
      const rawK = (clientW - MAIN_PADDING - (hidePanel ? 0 : PANEL_WIDTH) - 2) / tableMinWidth;
      const formatK = (clientW - MAIN_PADDING - (hidePanel ? 0 : PANEL_WIDTH) - 2) / formatMinWidth;
      setFiltersPanelHidden(hidePanel);
      const phone = window.innerWidth <= 700;
      const cardsPref = getCardsPref();
      // Авто: таблица не помещается даже при 72% масштаба (планшет, узкое окно) - карточки; «Карточки»
      const cards = phone || cardsPref === "on" || (cardsPref === "auto" && formatK < MIN_K);
      setCardLayout(cards);
      setTableScale(cards || window.innerWidth <= 720 ? 1 : Math.max(MIN_K, Math.min(MAX_K, Math.floor(rawK * 1000) / 1000)));
      setFitTick((n) => n + 1);
      setScaleReady(true);
    }
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener(VIEW_PREFS_EVENT, recompute);
    // Зонд меняет свою natural-ширину при смене видимых контор/режима отображения/подгрузки данных
    const ro = new ResizeObserver(recompute);
    if (tableProbeRef.current) ro.observe(tableProbeRef.current);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener(VIEW_PREFS_EVENT, recompute);
      ro.disconnect();
    };
  }, [visibleBookmakers.length, viewMode, panelManualHidden, loading]);

  // Новый базовый расчёт (окно/панель/конторы)
  useEffect(() => {
    setFitShrink(1);
  }, [tableScale, cardLayout, filtersPanelHidden]);
  useEffect(() => {
    if (cardLayout || Math.abs(tableScale - 1) < 0.001 || effectiveScale <= 0.722) return;
    const el = document.documentElement;
    if (el.scrollWidth - el.clientWidth > 1) setFitShrink((sh) => Math.max(0.5, sh * (el.clientWidth / el.scrollWidth) * 0.99));
  }, [tableScale, fitShrink, fitTick, cardLayout, filtersPanelHidden, effectiveScale]);

  // Если панель перестала быть скрытой (окно расширили обратно) - не оставляем "залипший" выдвинутый drawer открытым фоном
  useEffect(() => {
    if (!filtersPanelHidden) setMobileFiltersOpen(false);
  }, [filtersPanelHidden]);

  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty("--header-h", `${el.getBoundingClientRect().height}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const raf = requestAnimationFrame(() => requestAnimationFrame(apply));
    const timer = setTimeout(apply, 300);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);

  useEffect(() => {
    fetch("/api/board-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.prefs) {
          const p = normalizeBoardPrefs(j.prefs);
          setMinBooks(p.minBooks);
          setHiddenTags(new Set(p.hiddenTags));
          if (p.timeWindow) setTimeWindow(p.timeWindow);
        }
      })
      .catch(() => {})
      .finally(() => {
        boardPrefsLoadedRef.current = true;
      });
  }, []);
  useEffect(() => {
    if (!boardPrefsLoadedRef.current) return;
    const t = setTimeout(() => {
      fetch("/api/board-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: { minBooks, hiddenTags: [...hiddenTags], timeWindow } }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [minBooks, hiddenTags, timeWindow]);

  const filtered = useMemo(() => {
    let list = matches;

    if (timeWindow !== "all") {
      const hours = Number(timeWindow);
      const cutoff = Date.now() + hours * 60 * 60 * 1000;
      list = list.filter((m) => new Date(m.kickoffAt).getTime() <= cutoff);
    }

    if (leagueMode === "top") {
      list = list.filter((m) => isTopForSport(m.league, sportSlug) && (m.regularCount ?? 2) >= 2);
    } else if (leagueMode === "custom") {
      list = list.filter((m) => {
        const key = topKeyForSport(m.league, sportSlug);
        // Курируемая топ-лига - решает excludedTopKeys (независимо от того, знаем ли мы сейчас её сырое имя в БД)
        if (key) return !excludedTopKeys.has(key) && (m.regularCount ?? 2) >= 2;
        return customLeagues.has(m.league);
      });
    }
    // leagueMode === "all" - без фильтра по лиге

    if (sportSlug === "football") list = list.filter((m) => !isWomenMatch(m) && !isExcludedLeague(m.league));
    if (sportSlug === "hockey") list = list.filter((m) => !isFakeNhlMatch(m));

    // "Помогите Betmark" - матч, которого ИИ-проверка сочла подозрительным
    list = list.filter((m) => !m.topLeagueFlagged || m.topLeagueReviewAnswer === true);

    list = list.filter(
      (m) => topKeyForSport(m.league, sportSlug) !== "Сборные. Товарищеские матчи" || m.bookmakerCount > 1
    );

    // Нижние лиги, юниоры, кибер, малые страны и т.п
    list = list.filter((m) => (leagueMode === "custom" && customLeagues.has(m.league)) || !isHiddenByQuality(m, hiddenTags));
    if (minBooks > 1) {
      const visibleSlugs = new Set(visibleBookmakers.map((b) => b.slug));
      list = list.filter((m) => booksWithOdds(m.bookmakers, visibleSlugs) >= minBooks);
    }

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(q) ||
          m.awayTeam.toLowerCase().includes(q) ||
          m.league.toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    if (sortBy === "kickoff") {
      sorted.sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
    } else if (sortBy === "payout-desc" || sortBy === "payout-asc") {
      const visibleSlugs = new Set(visibleBookmakers.map((b) => b.slug));
      const dir = sortBy === "payout-desc" ? -1 : 1;
      sorted.sort((a, b) => {
        const pa = matchPayout(a, visibleSlugs);
        const pb = matchPayout(b, visibleSlugs);
        // матчи без полного набора кэфов (payout не посчитать) - в конец списка
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return (pa - pb) * dir;
      });
    }
    return sorted;
  }, [matches, minBooks, hiddenTags, query, timeWindow, leagueMode, customLeagues, excludedTopKeys, sortBy, visibleBookmakers, sportSlug]);

  const comparedCount = useMemo(() => filtered.filter((m) => m.bookmakerCount > 1).length, [filtered]);

  // Панель "Топ-лиги" в сайдбаре - список чекбоксов ИМЕННО куррируемых топ-лиг
  const topLeagueRawNames = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of matches) {
      if (sportSlug === "football" && (isWomenMatch(m) || isExcludedLeague(m.league))) continue;
      if (sportSlug === "hockey" && isFakeNhlMatch(m)) continue;
      const key = topKeyForSport(m.league, sportSlug);
      if (!key) continue;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(m.league);
    }
    return map;
  }, [matches, sportSlug]);

  const seededDefaultRef = useRef(false);
  useEffect(() => {
    if (seededDefaultRef.current) return;
    if (topLeagueRawNames.size === 0) return;
    seededDefaultRef.current = true;
    setExcludedTopKeys(new Set(["Сборные. Товарищеские матчи", "Лига наций"]));
    setLeagueMode("custom");
  }, [topLeagueRawNames]);

  const topLeagues = useMemo(() => {
    let base = matches;
    if (timeWindow !== "all") {
      const hours = Number(timeWindow);
      const cutoff = Date.now() + hours * 60 * 60 * 1000;
      base = base.filter((m) => new Date(m.kickoffAt).getTime() <= cutoff);
    }
    base = base.filter(
      (m) =>
        (sportSlug !== "football" || (!isWomenMatch(m) && !isExcludedLeague(m.league))) &&
        (sportSlug !== "hockey" || !isFakeNhlMatch(m)) &&
        isTopForSport(m.league, sportSlug)
    );

    const counts = new Map<string, number>();
    for (const name of topNamesForSport(sportSlug)) counts.set(name, 0);
    for (const m of base) {
      const key = topKeyForSport(m.league, sportSlug) ?? m.league;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [matches, timeWindow, sportSlug]);

  const grouped = useMemo(() => {
    if (viewMode !== "league") return null;
    const map = new Map<string, MatchRow[]>();
    for (const m of filtered) {
      const key = topKeyForSport(m.league, sportSlug) ?? m.league;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    // Сортировка по payout работает и в режиме "По лигам"
    const visibleSlugs = new Set(visibleBookmakers.map((b) => b.slug));
    const groups = Array.from(map.entries()).map(([leagueName, ms]) => {
      const sortedMs = [...ms].sort((a, b) => {
        if (sortBy === "payout-desc" || sortBy === "payout-asc") {
          const pa = matchPayout(a, visibleSlugs);
          const pb = matchPayout(b, visibleSlugs);
          const dir = sortBy === "payout-desc" ? -1 : 1;
          if (pa === null && pb === null) return 0;
          if (pa === null) return 1;
          if (pb === null) return -1;
          return (pa - pb) * dir;
        }
        return new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime();
      });
      return { league: leagueName, matches: sortedMs };
    });
    groups.sort(
      (a, b) => new Date(a.matches[0].kickoffAt).getTime() - new Date(b.matches[0].kickoffAt).getTime()
    );
    return groups;
  }, [filtered, viewMode, leagueMode, sortBy, visibleBookmakers, sportSlug]);

  function toggleBookmaker(slug: string) {
    setHiddenBookmakers((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function resetFilters() {
    setMinBooks(DEFAULT_MIN_BOOKS);
    setHiddenTags(new Set(DEFAULT_HIDDEN_TAGS));
    setQuery("");
    setTimeWindow("12");
    setLeagueMode("top");
    setCustomLeagues(new Set());
    setExcludedTopKeys(new Set());
    setSortBy("kickoff");
    setHiddenBookmakers(new Set(defaultHiddenBookmakers));
  }

  if (forbidden) {
    return (
      <div className="page-home">
        <header className="header">
          <SiteHeader />
        </header>
        <main className="main">
          <div className="page-subtitle">У вашего аккаунта нет доступа к этому разделу.</div>
        </main>
      </div>
    );
  }

  return (
    <div
      className={`page-home${cardLayout ? " card-layout" : ""}${effectiveScale < 0.999 ? " fit-tight" : ""}${effectiveScale > 1.001 ? " fit-grow" : ""}`}
      style={{ "--tk": effectiveScale } as React.CSSProperties}
    >
      <header className="header" ref={headerRef}>
        <SiteHeader />

        <div className="header-toolbar board-toolbar">
          <div className="bt-head">
            <div className="header-title-block">
              <h1 className="page-title">
                {sportSlug === "tennis" ? "Теннис" : sportSlug === "hockey" ? "Хоккей" : "Футбол"} · прематч
              </h1>
              <span className="page-subtitle">
                {loading
                  ? " "
                  : `${filtered.length} матчей · ${comparedCount} со сравнением между конторами`}
              </span>
            </div>

            <div className="bt-head-right">
              {reviewRemaining > 0 && (
                <button type="button" className="help-betmark-btn" onClick={() => setHelpQuizOpen(true)}>
                  Помогите Betmark
                </button>
              )}
              <div className="view-tabs">
              <button
                type="button"
                className={`view-tab${viewMode === "league" ? " view-tab-active" : ""}`}
                onClick={() => {
                  setViewMode("league");
                  setSortBy("kickoff");
                }}
              >
                По лигам
              </button>
              <button
                type="button"
                className={`view-tab${viewMode === "time" && sortBy !== "payout-desc" ? " view-tab-active" : ""}`}
                onClick={() => {
                  setViewMode("time");
                  setSortBy("kickoff");
                }}
              >
                По времени начала
              </button>
              <button
                type="button"
                className={`view-tab${sortBy === "payout-desc" ? " view-tab-active" : ""}`}
                onClick={() => {
                  setViewMode("time");
                  setSortBy("payout-desc");
                }}
              >
                Payout
              </button>
              </div>
            </div>
          </div>

          <div className="bt-bar">
            <div className="sport-switcher">
              <button
                type="button"
                className={`sport-switcher-tab${sportSlug === "football" ? " sport-switcher-tab-active" : ""}`}
                onClick={() => setSportSlug("football")}
              >
                <span className="msi">sports_soccer</span> Футбол
              </button>
              <button
                type="button"
                className={`sport-switcher-tab${sportSlug === "tennis" ? " sport-switcher-tab-active" : ""}`}
                onClick={() => setSportSlug("tennis")}
              >
                <span className="msi">sports_tennis</span> Теннис
              </button>
              <button
                type="button"
                className={`sport-switcher-tab${sportSlug === "hockey" ? " sport-switcher-tab-active" : ""}`}
                onClick={() => setSportSlug("hockey")}
              >
                <span className="msi">sports_hockey</span> Хоккей
              </button>
            </div>

            <div className="search-wrap toolbar-search">
              <span className="msi search-icon">search</span>
              <input
                className="search-input"
                type="text"
                placeholder="Найти команду или лигу"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {filtersPanelHidden && (
              <button type="button" className="calc-arb-btn calc-arb-btn-standalone" onClick={() => setMobileFiltersOpen(true)} title="Фильтры" aria-label="Фильтры">
                <span className="msi">tune</span>
              </button>
            )}
            {filtersPanelHidden && panelManualHidden && (
              <button type="button" className="calc-arb-btn calc-arb-btn-standalone" onClick={() => changePanelManualHidden(false)} title="Вернуть боковую панель на место" aria-label="Показать панель">
                <span className="msi">keyboard_double_arrow_right</span>
              </button>
            )}
            <button
              type="button"
              className="calc-arb-btn calc-arb-btn-standalone"
              onClick={() => setCalcStandaloneOpen(true)}
              title="Калькулятор вилки (вручную, без привязки к матчу)"
              aria-label="Калькулятор вилки вручную"
            >
              <span className="msi">calculate</span>
            </button>

          </div>
        </div>
      </header>

      <main className="main">
        {/* Кнопки открытия боковых панелей - показываются */}
        <div className="content-layout">
          {mobileFiltersOpen && (
            <div className="mobile-backdrop" onClick={() => setMobileFiltersOpen(false)} />
          )}
          <aside
            className={`filters-panel${filtersPanelHidden ? " panel-collapsed" : ""}${mobileFiltersOpen ? " mobile-open" : ""}`}
          >
            <div className="drawer-head">
              <span className="drawer-title">Фильтры</span>
              <button type="button" className="mobile-panel-close" onClick={() => setMobileFiltersOpen(false)} aria-label="Закрыть">
                <span className="msi">close</span>
              </button>
            </div>
            {!filtersPanelHidden && (
              <button type="button" className="panel-hide-btn" onClick={() => changePanelManualHidden(true)} title="Скрыть боковую панель: таблица и кэфы займут всю ширину">
                <span className="msi">keyboard_double_arrow_left</span> Скрыть панель
              </button>
            )}
            <div className="filter-group">
              <div className="filter-title">Диапазон времени</div>
              <div className="filter-radio-list">
                {TIME_WINDOWS.map((tw) => (
                  <label key={tw.value} className="filter-radio">
                    <input
                      type="radio"
                      name="timeWindow"
                      checked={timeWindow === tw.value}
                      onChange={() => setTimeWindow(tw.value)}
                    />
                    <span className="filter-radio-dot" />
                    <span>{tw.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-title">Лига</div>
              <div className="league-mode-tabs">
                <button
                  type="button"
                  className={`league-mode-tab${leagueMode === "top" ? " league-mode-tab-active" : ""}`}
                  onClick={() => setLeagueMode("top")}
                >
                  Топ-лиги
                </button>
                <button
                  type="button"
                  className={`league-mode-tab${leagueMode === "custom" ? " league-mode-tab-active" : ""}`}
                  onClick={() => {
                    if (leagueMode !== "custom") {
                      setCustomLeagues(new Set(leagues.filter((l) => isTopForSport(l, sportSlug))));
                    }
                    setLeagueMode("custom");
                  }}
                >
                  Выбрать
                </button>
              </div>
              {loadingAll && (
                <div className="league-loading-note">
                  <Loader inline size={16} /> Загружаю остальные лиги…
                </div>
              )}
              {leagueMode === "custom" && (
                <LeagueMultiSelect
                  options={leagues}
                  selected={customLeagues}
                  onChange={setCustomLeagues}
                  onOpen={() => setAllRequested(true)}
                />
              )}
              {leagueMode !== "all" ? (
                <button type="button" className="league-mode-all-link" onClick={() => setLeagueMode("all")}>
                  Показать все лиги без фильтра
                </button>
              ) : (
                <button type="button" className="league-mode-all-link" onClick={() => setLeagueMode("top")}>
                  ← Вернуться к топ-лигам
                </button>
              )}
            </div>

            <div className="filter-group">
              <div className="filter-title">Букмекеры</div>
              <div className="filter-check-list">
                {bookmakerSlugs.map((b) => (
                  <label key={b.slug} className="filter-check">
                    <input
                      type="checkbox"
                      checked={!hiddenBookmakers.has(b.slug)}
                      onChange={() => toggleBookmaker(b.slug)}
                    />
                    <span>{b.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-title">Минимум контор с кэфами на матче</div>
              <div className="filter-radio-list">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="filter-radio">
                    <input type="radio" name="minBooks" checked={minBooks === n} onChange={() => setMinBooks(n)} />
                    <span className="filter-radio-dot" />
                    <span>{n === 1 ? "Все матчи" : `${n} и больше`}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-title">Показывать также</div>
              <div className="filter-check-list">
                {MATCH_TAGS.map((t) => (
                  <label key={t.tag} className="filter-check">
                    <input
                      type="checkbox"
                      checked={!hiddenTags.has(t.tag)}
                      onChange={() =>
                        setHiddenTags((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.tag)) next.delete(t.tag);
                          else next.add(t.tag);
                          return next;
                        })
                      }
                    />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-title">Топ-лиги</div>
              <div className="top-leagues-list">
                {topLeagues.map(([name, count]) => {
                  // name - канонический ключ ("Ла Лига")
                  const checked = leagueMode === "custom" ? !excludedTopKeys.has(name) : true;
                  return (
                    <label key={name} className="top-league-item" title={name}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (leagueMode !== "custom") {
                            // Переход из "top"/"all" кликом по одной лиге
                            setExcludedTopKeys(new Set([name]));
                            setLeagueMode("custom");
                          } else {
                            const next = new Set(excludedTopKeys);
                            if (checked) next.add(name);
                            else next.delete(name);
                            setExcludedTopKeys(next);
                          }
                        }}
                      />
                      <span className="top-league-name">{name}</span>
                      <span className="top-league-count">{count}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button className="filter-reset" type="button" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          <div className="drawer-foot">
              <button type="button" className="drawer-apply" onClick={() => setMobileFiltersOpen(false)}>
                Показать матчи ({filtered.length})
              </button>
            </div>
          </aside>

          <div className="table-area">
            {loading || !scaleReady ? (
              <div className="table-loading">
                <Loader label="Загрузка матчей…" size={77} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="table-empty">Ничего не найдено</div>
            ) : (
            <div className="table-wrap">
              <table className="odds-table">
                <thead>
                  <tr>
                    <th className="col-match">Матч</th>
                    {viewMode === "time" && <th className="col-league">Лига</th>}
                    <th className="col-time">Начало</th>
                    {visibleBookmakers.map((b) => (
                      <th key={b.slug} className="col-bookmaker">
                        {b.name}
                      </th>
                    ))}
                    <th className="col-payout">
                      <button
                        type="button"
                        className="col-payout-sort-btn"
                        onClick={() =>
                          setSortBy(sortBy === "payout-desc" ? "payout-asc" : "payout-desc")
                        }
                      >
                        Payout %
                        {sortBy === "payout-desc" && <span className="msi col-sort-arrow">arrow_downward</span>}
                        {sortBy === "payout-asc" && <span className="msi col-sort-arrow">arrow_upward</span>}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {viewMode === "league" &&
                    grouped?.map((group) => (
                      <MatchGroup
                        key={group.league}
                        league={group.league}
                        matches={group.matches}
                        visibleBookmakers={visibleBookmakers}
                        colSpan={3 + visibleBookmakers.length}
                        showLeagueColumn={false}
                        sportSlug={sportSlug}
                        bookmakerFreshness={bookmakerFreshness}
                        onOpenCalculator={setCalcMatch}
                      onDelete={setDeleteMatch}
                      />
                    ))}
                  {viewMode === "time" && (
                    <MatchGroup
                      matches={filtered}
                      visibleBookmakers={visibleBookmakers}
                      colSpan={4 + visibleBookmakers.length}
                      sportSlug={sportSlug}
                      showLeagueColumn
                      bookmakerFreshness={bookmakerFreshness}
                      onOpenCalculator={setCalcMatch}
                      onDelete={setDeleteMatch}
                    />
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td className="empty-row" colSpan={4 + visibleBookmakers.length}>
                        Ничего не найдено
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>

        <table ref={tableProbeRef} className="odds-table table-probe" aria-hidden="true">
          <thead>
            <tr>
              <th className="col-match">Матч</th>
              {viewMode === "time" && <th className="col-league">Лига</th>}
              <th className="col-time">Начало</th>
              {visibleBookmakers.map((b) => (
                <th key={b.slug} className="col-bookmaker">
                  {b.name}
                </th>
              ))}
              <th className="col-payout">Payout %</th>
            </tr>
          </thead>
          <tbody>
            {viewMode === "league" &&
              grouped?.map((group) => (
                <MatchGroup
                  key={group.league}
                  league={group.league}
                  matches={group.matches}
                  visibleBookmakers={visibleBookmakers}
                  colSpan={3 + visibleBookmakers.length}
                  showLeagueColumn={false}
                  sportSlug={sportSlug}
                  bookmakerFreshness={bookmakerFreshness}
                  onOpenCalculator={() => {}}
                  onDelete={() => {}}
                />
              ))}
            {viewMode === "time" && (
              <MatchGroup
                matches={filtered}
                visibleBookmakers={visibleBookmakers}
                colSpan={4 + visibleBookmakers.length}
                sportSlug={sportSlug}
                showLeagueColumn
                bookmakerFreshness={bookmakerFreshness}
                onOpenCalculator={() => {}}
                  onDelete={() => {}}
              />
            )}
          </tbody>
        </table>
      </main>

      <footer className="footer">
        <span className="footer-text-full">Данные собираются автоматически, обновление таблицы каждые 30 секунд</span>
        <span className="footer-text-short">Обновление каждые 30 секунд</span>
      </footer>

      {calcMatch && (
        <SurebetCalculatorModal
          match={calcMatch}
          sportSlug={sportSlug}
          hiddenBookmakers={hiddenBookmakers}
          onClose={() => setCalcMatch(null)}
        />
      )}
      {calcStandaloneOpen && (
        <SurebetCalculatorModal
          match={null}
          sportSlug={sportSlug}
          hiddenBookmakers={hiddenBookmakers}
          onClose={() => setCalcStandaloneOpen(false)}
        />
      )}
      {deleteMatch && (
        <DeleteMatchModal
          match={deleteMatch}
          canDeleteAll={!!myPerms.match_delete_all}
          busy={deleteBusy}
          error={deleteError}
          onClose={() => {
            setDeleteMatch(null);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
      {undoInfo && (
        <div className="undo-bar" role="status">
          <span className="undo-bar-text">
            Матч «{undoInfo.match.homeTeam} — {undoInfo.match.awayTeam}» удалён {undoInfo.scope === "all" ? "у всех" : "только у вас"}
          </span>
          <button type="button" className="undo-bar-btn" onClick={undoDelete}>
            Отменить
          </button>
        </div>
      )}
      {helpQuizOpen && (
        <HelpBetmarkQuizModal
          onClose={() => {
            setHelpQuizOpen(false);
            loadReviewRemaining();
          }}
        />
      )}
    </div>
  );
}

function DeleteMatchModal({
  match,
  canDeleteAll,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  match: MatchRow;
  canDeleteAll: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (scope: "me" | "all") => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box delete-match-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Удалить матч</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="modal-body">
          <div className="delete-match-teams">
            {match.homeTeam} — {match.awayTeam}
          </div>
          <div className="delete-match-meta">
            {match.league} · {formatKickoff(match.kickoffAt)}
          </div>
          <button type="button" className="delete-scope-card" disabled={busy} onClick={() => onConfirm("me")}>
            <span className="msi delete-scope-icon">person</span>
            <span className="delete-scope-text">
              <span className="delete-scope-title">Только у этого аккаунта</span>
              <span className="delete-scope-desc">Матч скроется только у вас, остальные пользователи его по-прежнему видят.</span>
            </span>
          </button>
          <button type="button" className="delete-scope-card delete-scope-card-all" disabled={busy || !canDeleteAll} onClick={() => onConfirm("all")}>
            <span className="msi delete-scope-icon">groups</span>
            <span className="delete-scope-text">
              <span className="delete-scope-title">У всех аккаунтов</span>
              <span className="delete-scope-desc">
                {canDeleteAll
                  ? "Матч исчезнет у всех пользователей и из автоотслеживания."
                  : "Недоступно: включите «Удаление матча у всех аккаунтов» в правах этого аккаунта (админ-панель, Права Betmark)."}
              </span>
            </span>
          </button>
          {error && <div className="delete-match-error">{error}</div>}
          <button type="button" className="delete-match-cancel" onClick={onClose} disabled={busy}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

interface TopLeagueReviewMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sportLabel: string;
  kickoffAt: string;
  reason: string | null;
}

function HelpBetmarkQuizModal({ onClose }: { onClose: () => void }) {
  const [next, setNext] = useState<TopLeagueReviewMatch | null | undefined>(undefined); // undefined = ещё не загружено
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNext = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/top-league-review`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNext(data.next);
      setRemaining(data.remaining ?? 0);
    } catch {
      setError("Не удалось загрузить следующий вопрос - попробуйте ещё раз.");
      setNext(null);
    }
  };

  useEffect(() => {
    loadNext();
  }, []);

  const answer = async (isTop: boolean) => {
    if (!next || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/top-league-review/${next.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: isTop }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadNext();
    } catch {
      setError("Не удалось сохранить ответ - попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box help-quiz-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Помогите Betmark</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="modal-body">
          {next === undefined ? (
            <Loader label="Загрузка…" size={63} />
          ) : next === null ? (
            <div className="page-subtitle">Подозрительных матчей сейчас нет - спасибо за помощь!</div>
          ) : (
            <>
              <div className="page-subtitle" style={{ marginBottom: 10 }}>
                Осталось вопросов: {remaining}
              </div>
              <div className="help-quiz-match">
                {next.homeTeam} — {next.awayTeam}
              </div>
              <div className="page-subtitle" style={{ marginBottom: 10 }}>
                {next.sportLabel} · {next.league} · {formatKickoff(next.kickoffAt)}
              </div>
              {next.reason && <div className="help-quiz-reason">Почему возник вопрос: {next.reason}</div>}
              <div className="help-quiz-question">Это топ-лига?</div>
              <div className="help-quiz-actions">
                <button type="button" className="help-quiz-btn help-quiz-btn-yes" disabled={submitting} onClick={() => answer(true)}>
                  Да
                </button>
                <button type="button" className="help-quiz-btn help-quiz-btn-no" disabled={submitting} onClick={() => answer(false)}>
                  Нет
                </button>
              </div>
            </>
          )}
          {error && <div className="help-quiz-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
