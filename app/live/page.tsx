"use client";

// Вкладка "Live-трекер"
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SurebetCalculatorModal, { type CalcMatch } from "@/components/SurebetCalculatorModal";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Loader from "@/components/Loader";
import { useBetmarkPerms } from "@/lib/useBetmarkPerms";
import { useParsedBooks } from "@/lib/useParsedBooks";
import ReportPrepareAsk from "@/components/ReportPrepareAsk";
import { DetailLevelList, BookmakerFold } from "@/components/TrackOptions";
import type { BetmarkPerms } from "@/lib/betmarkPermKeys";
import {
  LIVE_ADAPTER_SLUGS,
  LIVE_ADAPTER_DISPLAY,
  MANDATORY_LIVE_ADAPTER,
  TENNIS_LIVE_ADAPTER_SLUGS,
  CRYPTO_LIVE_ADAPTER_SLUGS,
  CRYPTO_LIVE_ADAPTER_DISPLAY,
  isCryptoLiveAdapterSlug,
  isCryptoSiteHost,
  LIVE_DETAIL_LEVELS,
  LIVE_DETAIL_LEVEL_CONFIG,
  DEFAULT_LIVE_DETAIL_LEVEL,
  type LiveDetailLevel,
} from "@/lib/liveAdapters";
import { isTopLeague } from "@/lib/topLeagues";
import { isTopHockeyLeague } from "@/lib/topHockey";
import { isTopTennisTournament } from "@/lib/topTennis";
import { DEFAULT_HIDDEN_TAGS, isHiddenByQuality } from "@/lib/matchQuality";
const LIVE_PICKER_HIDDEN = new Set(DEFAULT_HIDDEN_TAGS);

// «топ» для выбранного вида спорта: футбольные лиги, НХЛ/КХЛ и т.п., у тенниса - ATP/WTA и турниры Большого шлема
function isTopFor(sport: string, league: string): boolean {
  if (sport === "tennis") return isTopTennisTournament(league);
  if (sport === "hockey") return isTopHockeyLeague(league);
  return isTopLeague(league);
}

// Единый live-трекер для example.com и example.com в окне выбора матча рядом с российскими конторами появляется
const CRYPTO_ON_BY_DEFAULT = typeof window !== "undefined" && isCryptoSiteHost(window.location.hostname);
function defaultSelection(bookmakerSlugs: string[], sport?: string): Set<string> {
  const available: string[] = LIVE_ADAPTER_SLUGS.filter((slug) => bookmakerSlugs.includes(slug) && (sport !== "tennis" || TENNIS_LIVE_ADAPTER_SLUGS.includes(slug)));
  if (CRYPTO_ON_BY_DEFAULT && sport !== "tennis") available.push(...CRYPTO_LIVE_ADAPTER_SLUGS.filter((slug) => bookmakerSlugs.includes(slug)));
  return new Set(available.length > 0 ? available : [MANDATORY_LIVE_ADAPTER]);
}

interface MatchOption {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: string;
  // Все конторы, у которых есть кэфы на этот матч (не только live-адаптеры)
  bookmakerSlugs: string[];
  // Матч, который УЖЕ идёт прямо сейчас /api/live-matches - "добавлять матчи в лайве на отслеживание")
  isLive?: boolean;
  scoreHome?: number | null;
  scoreAway?: number | null;
  matchMinute?: number | null;
  scoreDetail?: string | null; // теннис: геймы по сетам и очки гейма
}

interface LiveOddsRow {
  slug: string;
  // У конторы сейчас нет цены (рынок закрыт/нет данных) - строка остаётся, с пометкой
  unavailable?: boolean;
  price1: number | null;
  priceX: number | null;
  price2: number | null;
  t1: "up" | "down" | null;
  tX: "up" | "down" | null;
  t2: "up" | "down" | null;
}

interface Tracking {
  id: string;
  // Последние цены контор у идущего отслеживания
  liveOdds?: LiveOddsRow[];
  // откуда отслеживание: manual / autotrack / autoscan
  source?: string;
  status: "SCHEDULED" | "TRACKING" | "FINISHED" | "FAILED";
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  sport: string;
  league: string;
  kickoffAt: string;
  startedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  scoreHome: number | null;
  scoreAway: number | null;
  matchMinute: number | null;
  scoreDetail?: string | null; // теннис: геймы по сетам и очки гейма, например "6:4 3:3 · 15:30"
  // Секунды от начала матча (до секунд на карточке LIVE)
  matchTimerSeconds?: number | null;
  bookmakerSlugs: string[];
  // Реально прислали хоть одну цену
  actualBookmakerCount: number;
  detailLevel: LiveDetailLevel;
  hasReport: boolean;
  // Второй PDF БЕЗ финальной ИИ-зачистки - есть только у завершённых отслеживаний уровня ULTRA, см. generate-live-report.ts
  hasReportRaw: boolean;
  createdAt: string;
}

const SPORT_LABELS: Record<string, string> = { football: "Футбол", tennis: "Теннис", hockey: "Хоккей" };

// Личные настройки списка отслеживаний сервер сканирует все идущие топ-матчи (Live-автоскан)
type LiveSource = "manual" | "autotrack" | "autoscan";
type LiveSortKey = "minute" | "start" | "league" | "payout" | "books";
interface LivePrefs {
  hidden: string[];
  hiddenBooks: string[];
  sources: Record<LiveSource, boolean>;
  sort: LiveSortKey;
  dir: "asc" | "desc";
  showHidden: boolean;
}
const DEFAULT_LIVE_PREFS: LivePrefs = { hidden: [], hiddenBooks: [], sources: { manual: true, autotrack: true, autoscan: true }, sort: "minute", dir: "desc", showHidden: false };
const LIVE_SORT_LABELS: Record<LiveSortKey, string> = { minute: "Минута матча", start: "Время начала", league: "Лига", payout: "Payout по лучшим кэфам", books: "Число контор с ценой" };
const bookName = (slug: string) => (LIVE_ADAPTER_DISPLAY as Record<string, string>)[slug] ?? (CRYPTO_LIVE_ADAPTER_DISPLAY as Record<string, string>)[slug] ?? slug;
type BookFilter = { has(slug: string): boolean } | null;
function visibleOdds(t: { liveOdds?: LiveOddsRow[] }, books: BookFilter): LiveOddsRow[] {
  return (t.liveOdds ?? []).filter((o) => !books || books.has(o.slug));
}
function bestPayout(t: { liveOdds?: LiveOddsRow[]; sport: string }, books: BookFilter): number {
  const priced = visibleOdds(t, books).filter((o) => !o.unavailable);
  const best = (k: "price1" | "priceX" | "price2") => Math.max(0, ...priced.map((o) => o[k] ?? 0));
  const b1 = best("price1"), bx = best("priceX"), b2 = best("price2");
  if (!b1 || !b2 || (t.sport !== "tennis" && !bx)) return 0;
  return 100 / (1 / b1 + 1 / b2 + (t.sport !== "tennis" ? 1 / bx : 0));
}

const STATUS_LABELS: Record<Tracking["status"], string> = {
  SCHEDULED: "Ожидает начала",
  TRACKING: "Идёт live",
  FINISHED: "Завершено",
  FAILED: "Не удалось",
};

const STATUS_CLASS: Record<Tracking["status"], string> = {
  SCHEDULED: "live-badge-wait",
  TRACKING: "live-badge-live",
  FINISHED: "live-badge-done",
  FAILED: "live-badge-fail",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMinute(n: number): string {
  return `${n} минута`;
}

function ReportBooksModal({ onClose, onSaved }: { onClose: () => void; onSaved: (count: number | null) => void }) {
  const isParsed = useParsedBooks(); // только парсящиеся конторы
  const regular = (LIVE_ADAPTER_SLUGS as readonly string[]).filter(isParsed);
  const crypto = (CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[]).filter(isParsed);
  const ALL = [...regular, ...crypto];
  const [sel, setSel] = useState<Set<string>>(new Set(ALL));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false); // вопрос «будете часто менять этот выбор?» после «Сохранить»
  useEffect(() => {
    fetch("/api/report-books")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        const rb: string[] = Array.isArray(j?.books) ? j.books : [];
        setSel(new Set(rb.length > 0 ? rb : ALL));
      })
      .catch(() => setErr("Не удалось загрузить ваш набор контор."))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (slug: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        if (next.size > 1) next.delete(slug); // хотя бы одна контора должна остаться
      } else next.add(slug);
      return next;
    });
  const save = async (prepare: boolean | null) => {
    setBusy(true);
    setErr(null);
    try {
      const allOn = ALL.every((x) => sel.has(x));
      const res = await fetch("/api/report-books", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: allOn ? [] : ALL.filter((x) => sel.has(x)), prepare: prepare === true }) });
      if (!res.ok) {
        setErr(res.status === 403 || res.status === 401 ? "Нет доступа к настройкам лайва." : "Не удалось сохранить.");
        return;
      }
      onSaved(allOn ? null : sel.size);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const chip = (slug: string) => {
    const on = sel.has(slug);
    return (
      <button key={slug} type="button" className={`live-bookmaker-chip${on ? " live-bookmaker-chip-on" : ""}`} onClick={() => toggle(slug)}>
        <span className="msi live-bookmaker-chip-icon">{on ? "check_circle" : "radio_button_unchecked"}</span>
        {bookName(slug)}
      </button>
    );
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      {asking && typeof document !== "undefined" && createPortal(<ReportPrepareAsk count={sel.size} busy={busy} err={err} onAnswer={(p) => save(p)} onBack={() => setAsking(false)} />, document.body)}
      <div className="modal-box report-picker" role="dialog" aria-modal="true" aria-label="Конторы в отчётах" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Конторы в отчётах</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="report-picker-body">
          {!loaded ? (
            <Loader label="Загрузка…" size={63} />
          ) : (
            <>
              <div className="report-picker-presets">
                <button type="button" className="st-link-btn" onClick={() => setSel(new Set(ALL))}>Все</button>
                <button type="button" className="st-link-btn" onClick={() => setSel(new Set(regular))}>Только обычные</button>
                <button type="button" className="st-link-btn" onClick={() => setSel(new Set(crypto))}>Только крипто</button>
              </div>
              <div className="report-picker-group">
                <div className="report-picker-group-title">Обычные конторы</div>
                <div className="report-picker-chips">{regular.map(chip)}</div>
              </div>
              <div className="report-picker-group">
                <div className="report-picker-group-title">Крипто-конторы</div>
                <div className="report-picker-chips">{crypto.map(chip)}</div>
              </div>
              <div className="report-picker-note">
                Набор личный: он применяется ко всем отчётам, которые скачиваете вы (и к новым, и к уже готовым), а у других аккаунтов свой набор. Новые отчёты готовятся в таком виде сразу после матча, у старых набор собирается один раз при первом скачивании. Если у матча нет данных от выбранной конторы, её колонки в отчёте не будет.
              </div>
              {err && <div className="live-error" style={{ marginTop: 10 }}>{err}</div>}
            </>
          )}
        </div>
        <div className="report-picker-actions">
          <button type="button" className="logs-button" disabled={!loaded || busy} onClick={() => (ALL.every((x) => sel.has(x)) ? save(null) : setAsking(true))}>
            <span className="msi">check</span>
            Сохранить · {sel.size} из {ALL.length}
          </button>
          <button type="button" className="logs-button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LivePage() {
  const { perms, hasAccess, loading: permsLoading } = useBetmarkPerms();
  const isParsedBook = useParsedBooks();
  const PARSED_REGULAR = LIVE_ADAPTER_SLUGS.filter(isParsedBook);
  const PARSED_CRYPTO = CRYPTO_LIVE_ADAPTER_SLUGS.filter(isParsedBook);
  const [view, setView] = useState<"matches" | "history" | "autotrack" | "status">("matches");
  // общий набор контор для отчётов (null - все или неизвестно): подпись на единственной кнопке «Конторы в отчётах»
  const [reportBooksOpen, setReportBooksOpen] = useState(false);
  const [reportCount, setReportCount] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/report-books")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setReportCount(Array.isArray(j?.books) && j.books.length > 0 ? j.books.length : null))
      .catch(() => undefined);
  }, []);
  const [collapsedHistorySports, setCollapsedHistorySports] = useState<Set<"football" | "hockey" | "tennis">>(new Set());
  const [sportSlug, setSportSlug] = useState<"football" | "hockey" | "tennis">("football");
  const [showAllLeagues, setShowAllLeagues] = useState(false);
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesLoadFailed, setMatchesLoadFailed] = useState(false);
  // Матчи, которые уже идут прямо сейчас отдельный источник - /api/live-matches, не /api/matches
  const [liveMatches, setLiveMatches] = useState<MatchOption[]>([]);
  const [liveMatchesLoading, setLiveMatchesLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [trackings, setTrackings] = useState<Tracking[]>([]);
  const [livePrefs, setLivePrefs] = useState<LivePrefs>(DEFAULT_LIVE_PREFS);
  const livePrefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    fetch("/api/live-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const p = j?.prefs;
        if (p && typeof p === "object") setLivePrefs({ ...DEFAULT_LIVE_PREFS, ...p, sources: { ...DEFAULT_LIVE_PREFS.sources, ...(p.sources || {}) } });
      })
      .catch(() => undefined);
  }, []);
  const saveLivePrefs = (p: LivePrefs) => {
    setLivePrefs(p);
    if (livePrefsTimer.current) clearTimeout(livePrefsTimer.current);
    livePrefsTimer.current = setTimeout(() => {
      fetch("/api/live-prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefs: p }) }).catch(() => undefined);
    }, 500);
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBookmakers, setSelectedBookmakers] = useState<Record<string, Set<string>>>({});
  const [selectedDetailLevel, setSelectedDetailLevel] = useState<Record<string, LiveDetailLevel>>({});
  const [trackModalMatchId, setTrackModalMatchId] = useState<string | null>(null);
  const [editSelection, setEditSelection] = useState<{
    trackingId: string;
    homeTeam: string;
    awayTeam: string;
    bookmakers: Set<string>;
    detailLevel: LiveDetailLevel;
  } | null>(null);

  async function loadMatches() {
    setMatchesLoading(true);
    try {
      const res = await fetch(`/api/matches?sport=${sportSlug}&withCrypto=1${showAllLeagues ? "" : "&topOnly=1"}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const opts: MatchOption[] = (data.matches ?? []).map(
        (m: { id: string; homeTeam: string; awayTeam: string; league: string; kickoffAt: string; bookmakers: { slug: string }[] }) => ({
          id: m.id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league,
          kickoffAt: m.kickoffAt,
          bookmakerSlugs: m.bookmakers.map((b) => b.slug),
        })
      );
      setMatches(opts);
      setMatchesLoadFailed(false);
      // По умолчанию - все доступные для этого матча live-конторы включены (не только Book A)
      setSelectedBookmakers((prev) => {
        const next = { ...prev };
        for (const m of opts) {
          if (next[m.id]) continue;
          next[m.id] = defaultSelection(m.bookmakerSlugs, sportSlug);
        }
        return next;
      });
      setSelectedDetailLevel((prev) => {
        const next = { ...prev };
        for (const m of opts) {
          if (!next[m.id]) next[m.id] = DEFAULT_LIVE_DETAIL_LEVEL;
        }
        return next;
      });
    } catch (e) {
      console.error("не удалось загрузить список матчей:", e);
      setMatchesLoadFailed(true);
    } finally {
      setMatchesLoading(false);
    }
  }

  async function loadLiveMatches() {
    setLiveMatchesLoading(true);
    try {
      const res = await fetch(`/api/live-matches?sport=${sportSlug}`);
      const data = await res.json();
      const opts: MatchOption[] = (data.matches ?? []).map(
        (m: {
          id: string;
          homeTeam: string;
          awayTeam: string;
          league: string;
          kickoffAt: string;
          bookmakerSlugs: string[];
          scoreHome: number | null;
          scoreAway: number | null;
          matchMinute: number | null;
          scoreDetail?: string | null;
        }) => ({
          id: m.id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league,
          kickoffAt: m.kickoffAt,
          bookmakerSlugs: m.bookmakerSlugs,
          isLive: true,
          scoreHome: m.scoreHome,
          scoreAway: m.scoreAway,
          matchMinute: m.matchMinute,
          scoreDetail: m.scoreDetail ?? null,
        })
      );
      setLiveMatches(opts);
      setSelectedBookmakers((prev) => {
        const next = { ...prev };
        for (const m of opts) {
          if (next[m.id]) continue;
          next[m.id] = defaultSelection(m.bookmakerSlugs, sportSlug);
        }
        return next;
      });
      setSelectedDetailLevel((prev) => {
        const next = { ...prev };
        for (const m of opts) {
          if (!next[m.id]) next[m.id] = DEFAULT_LIVE_DETAIL_LEVEL;
        }
        return next;
      });
    } catch (e) {
      // Уже опрашивается раз в 30 сек - сбой сам восстановится на следующем тике
      console.error("не удалось загрузить лайв-матчи:", e);
    } finally {
      setLiveMatchesLoading(false);
    }
  }

  function toggleBookmaker(matchId: string, slug: string) {
    if (slug === MANDATORY_LIVE_ADAPTER) return; // обязательная контора, чекбокс не снимается
    setSelectedBookmakers((prev) => {
      const current = new Set(prev[matchId] ?? [MANDATORY_LIVE_ADAPTER]);
      if (current.has(slug)) current.delete(slug);
      else current.add(slug);
      return { ...prev, [matchId]: current };
    });
  }

  function toggleAllBookmakers(matchId: string, availableSlugs: readonly string[], allCurrentlyOn: boolean) {
    setSelectedBookmakers((prev) => ({
      ...prev,
      [matchId]: new Set([
        ...(allCurrentlyOn ? [MANDATORY_LIVE_ADAPTER] : availableSlugs),
        ...[...(prev[matchId] ?? [])].filter((slug) => isCryptoLiveAdapterSlug(slug)),
      ]),
    }));
  }

  // То же для колонки "Крипто": включить/выключить все доступные крипто-конторы, российские не трогаем
  function toggleAllCrypto(matchId: string, availableSlugs: readonly string[], allCurrentlyOn: boolean) {
    setSelectedBookmakers((prev) => {
      const next = new Set([...(prev[matchId] ?? [MANDATORY_LIVE_ADAPTER])].filter((slug) => !isCryptoLiveAdapterSlug(slug)));
      if (!allCurrentlyOn) for (const slug of availableSlugs) next.add(slug);
      return { ...prev, [matchId]: next };
    });
  }

  async function loadTrackings() {
    try {
      const res = await fetch("/api/live-tracking");
      const data = await res.json();
      setTrackings(data.trackings ?? []);
    } catch (e) {
      // Опрашивается раз в 10 сек - сбой сам восстановится на следующем тике
      console.error("не удалось загрузить список отслеживаний:", e);
    }
  }

  useEffect(() => {
    setMatches([]);
    setLiveMatches([]);
    loadMatches();
    loadLiveMatches();
    // Лайв-матчи - список может устареть за секунды (матч заканчивается)
    const liveInterval = setInterval(loadLiveMatches, 30000);
    const matchesInterval = setInterval(loadMatches, 60000);
    return () => {
      clearInterval(liveInterval);
      clearInterval(matchesInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportSlug, showAllLeagues]);

  useEffect(() => {
    loadTrackings();
    const interval = setInterval(loadTrackings, 10000);
    return () => clearInterval(interval);
  }, []);

  const trackedMatchIds = new Set(trackings.filter((t) => t.status === "SCHEDULED" || t.status === "TRACKING").map((t) => t.matchId));

  const filteredMatches = matches
    .filter((m) => m.bookmakerSlugs.includes(MANDATORY_LIVE_ADAPTER) && !trackedMatchIds.has(m.id))
    // в режиме "Все" те же правила, что на доске по умолчанию (lib/matchQuality.ts)
    .filter((m) => (showAllLeagues ? !isHiddenByQuality(m, LIVE_PICKER_HIDDEN) : isTopFor(sportSlug, m.league)))
    .filter((m) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q) || m.league.toLowerCase().includes(q);
    });

  const filteredLiveMatches = liveMatches
    .filter((m) => m.bookmakerSlugs.includes(MANDATORY_LIVE_ADAPTER) && !trackedMatchIds.has(m.id))
    .filter((m) => isTopFor(sportSlug, m.league))
    .filter((m) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return m.homeTeam.toLowerCase().includes(q) || m.awayTeam.toLowerCase().includes(q) || m.league.toLowerCase().includes(q);
    });

  async function startTracking(matchId: string) {
    setError(null);
    setBusyId(matchId);
    try {
      const bookmakers = [...(selectedBookmakers[matchId] ?? [MANDATORY_LIVE_ADAPTER])];
      const detailLevel = selectedDetailLevel[matchId] ?? DEFAULT_LIVE_DETAIL_LEVEL;
      const res = await fetch("/api/live-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, bookmakers, detailLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "не удалось поставить в очередь");
        return;
      }
      setTrackModalMatchId(null);
      await loadTrackings();
    } finally {
      setBusyId(null);
    }
  }

  async function stopTracking(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/live-tracking/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "не удалось остановить");
        return;
      }
      await loadTrackings();
    } finally {
      setBusyId(null);
    }
  }

  async function removeTracking(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/live-tracking/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "не удалось удалить");
        return;
      }
      await loadTrackings();
    } finally {
      setBusyId(null);
    }
  }

  function openEditModal(t: Tracking) {
    setError(null);
    setEditSelection({ trackingId: t.id, homeTeam: t.homeTeam, awayTeam: t.awayTeam, bookmakers: new Set(t.bookmakerSlugs), detailLevel: t.detailLevel });
  }

  function toggleEditBookmaker(slug: string) {
    if (slug === MANDATORY_LIVE_ADAPTER) return;
    setEditSelection((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.bookmakers);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, bookmakers: next };
    });
  }

  async function updateTracking() {
    if (!editSelection) return;
    setError(null);
    setBusyId(editSelection.trackingId);
    try {
      const res = await fetch(`/api/live-tracking/${editSelection.trackingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", bookmakers: [...editSelection.bookmakers], detailLevel: editSelection.detailLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "не удалось изменить");
        return;
      }
      setEditSelection(null);
      await loadTrackings();
    } finally {
      setBusyId(null);
    }
  }

  const activeAll = trackings.filter((t) => t.status === "SCHEDULED" || t.status === "TRACKING");
  const hiddenBookSet = new Set(livePrefs.hiddenBooks ?? []);
  const myBooks: BookFilter = hiddenBookSet.size ? { has: (slug: string) => !hiddenBookSet.has(slug) } : null;
  const hiddenSet = new Set(livePrefs.hidden);
  const hiddenActiveCount = activeAll.filter((t) => hiddenSet.has(t.id)).length;
  const liveSortVal = (t: Tracking): number | string => {
    switch (livePrefs.sort) {
      case "minute":
        return t.status === "TRACKING" ? (t.matchTimerSeconds ?? (t.matchMinute ?? 0) * 60) : -1;
      case "start":
        return new Date(t.kickoffAt).getTime();
      case "league":
        return t.league || "";
      case "payout":
        return bestPayout(t, myBooks);
      case "books":
        return visibleOdds(t, myBooks).filter((o) => !o.unavailable).length;
    }
  };
  const activeTrackings = activeAll
    .filter((t) => livePrefs.sources[(t.source ?? "manual") as LiveSource] ?? true)
    .filter((t) => livePrefs.showHidden || !hiddenSet.has(t.id))
    .sort((a, b) => {
      const va = liveSortVal(a), vb = liveSortVal(b);
      const c = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb), "ru") : (va as number) - (vb as number);
      return livePrefs.dir === "asc" ? c : -c;
    });
  const allLiveBooks = [...new Set(activeAll.flatMap((t) => t.bookmakerSlugs))].sort((a, b) => {
    const order = [...(LIVE_ADAPTER_SLUGS as readonly string[]), ...(CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[])];
    return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99);
  });
  const toggleHidden = (id: string) => saveLivePrefs({ ...livePrefs, hidden: hiddenSet.has(id) ? livePrefs.hidden.filter((x) => x !== id) : [...livePrefs.hidden, id].slice(-500) });
  const pastTrackingsAll = trackings.filter((t) => t.status === "FINISHED" || t.status === "FAILED");

  if (!permsLoading && (!hasAccess || !perms.live_view)) {
    return (
      <>
        <header className="header">
          <SiteHeader />
        </header>
        <main className="main">
          <div className="page-subtitle">
            {hasAccess ? "У вашего аккаунта нет доступа к этому разделу." : "Доступ к Betmark для этого аккаунта отключён."}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <header className="header">
        <SiteHeader />
      </header>

      <main className="main">
        <div className="match-header">
          <h1 className="match-header-title">Live-трекер</h1>
          <div className="match-header-meta">
            Ловим каждое изменение коэффициентов и голы, после матча собираем PDF-отчёт.
          </div>
        </div>

        {error && <div className="live-error">{error}</div>}

        <div className="market-tabs" style={{ marginBottom: 16 }}>
          <button type="button" className={`view-tab${view === "matches" ? " view-tab-active" : ""}`} onClick={() => setView("matches")}>
            Матчи
          </button>
          <button type="button" className={`view-tab${view === "history" ? " view-tab-active" : ""}`} onClick={() => setView("history")}>
            История{pastTrackingsAll.length > 0 ? ` (${pastTrackingsAll.length})` : ""}
          </button>
          <button type="button" className={`view-tab${view === "autotrack" ? " view-tab-active" : ""}`} onClick={() => setView("autotrack")}>
            Автослежение
          </button>
          <button type="button" className="view-tab report-books-btn live-tabs-action" onClick={() => setReportBooksOpen(true)} title="Какие конторы показывать в ваших PDF-отчётах (набор личный)">
            <span className="msi" style={{ fontSize: 18, verticalAlign: -4, marginRight: 4 }}>tune</span>
            Конторы в отчётах{reportCount != null ? ` · ${reportCount}` : ""}
          </button>
        </div>
        {reportBooksOpen && typeof document !== "undefined" && createPortal(<ReportBooksModal onClose={() => setReportBooksOpen(false)} onSaved={setReportCount} />, document.body)}

        {view === "autotrack" ? (
          <>
            <AutoTrackWaitingList />
            <AutoTrackPanel perms={perms} />
          </>
        ) : view === "history" ? (
          <>
            {pastTrackingsAll.length === 0 ? (
              <div className="market-placeholder">Пока пусто - здесь появятся завершённые и неудавшиеся отслеживания.</div>
            ) : (
              (["football", "hockey", "tennis"] as const).map((sport) => {
                const rows = pastTrackingsAll
                  .filter((t) => t.sport === sport)
                  .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
                const collapsed = collapsedHistorySports.has(sport);
                return (
                  <div key={sport}>
                    <button
                      type="button"
                      className="section-heading section-heading-toggle"
                      style={{ marginTop: sport === "football" ? 0 : undefined }}
                      onClick={() =>
                        setCollapsedHistorySports((prev) => {
                          const next = new Set(prev);
                          if (next.has(sport)) next.delete(sport);
                          else next.add(sport);
                          return next;
                        })
                      }
                    >
                      <span className={`msi section-heading-chevron${collapsed ? "" : " section-heading-chevron-open"}`}>chevron_right</span>
                      {SPORT_LABELS[sport] ?? sport}
                      {rows.length > 0 ? ` (${rows.length})` : ""}
                    </button>
                    {collapsed ? null : rows.length === 0 ? (
                      <div className="market-placeholder">Пока пусто.</div>
                    ) : (
                      <div className="live-tracking-list">
                        {rows.map((t) => (
                          <TrackingCard key={t.id} t={t} busy={busyId === t.id} onStop={() => stopTracking(t.id)} onRemove={() => removeTracking(t.id)} perms={perms} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        ) : (
          <>
            {activeAll.length > 0 && (
              <div className="lp-bar">
                <div className="lp-group">
                  <span className="lp-label">Конторы</span>
                  <div className="lp-chips">
                    {allLiveBooks.map((s) => {
                      const on = !hiddenBookSet.has(s);
                      return (
                        <button
                          type="button"
                          key={s}
                          className={`lp-chip${on ? " on" : " off"}`}
                          title={on ? "Убрать контору: пропадёт из карточек, payout и калькулятор пересчитаются без неё" : "Вернуть контору"}
                          onClick={() => saveLivePrefs({ ...livePrefs, hiddenBooks: on ? [...(livePrefs.hiddenBooks ?? []), s] : (livePrefs.hiddenBooks ?? []).filter((x) => x !== s) })}
                        >
                          {bookName(s)}
                        </button>
                      );
                    })}
                    {hiddenBookSet.size > 0 ? (
                      <button type="button" className="lp-link" onClick={() => saveLivePrefs({ ...livePrefs, hiddenBooks: [] })}>
                        вернуть все ({hiddenBookSet.size})
                      </button>
                    ) : (
                      <span className="lp-hint">нажмите на контору, чтобы убрать её - payout пересчитается</span>
                    )}
                  </div>
                </div>
                <div className="lp-row">
                  <div className="lp-group">
                    <span className="lp-label">Показывать</span>
                    <div className="lp-chips">
                      {(["manual", "autotrack", "autoscan"] as LiveSource[]).map((src) => (
                        <button
                          type="button"
                          key={src}
                          className={`lp-chip${livePrefs.sources[src] ? " on" : ""}`}
                          onClick={() => saveLivePrefs({ ...livePrefs, sources: { ...livePrefs.sources, [src]: !livePrefs.sources[src] } })}
                        >
                          {src === "manual" ? "Поставленные вручную" : src === "autotrack" ? "Автоотслеживание лиг" : "Автоскан топ-матчей"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="lp-group">
                    <span className="lp-label">Сортировка</span>
                    <select className="lp-select" aria-label="Сортировка" value={livePrefs.sort} onChange={(e) => saveLivePrefs({ ...livePrefs, sort: e.target.value as LiveSortKey })}>
                      {(Object.keys(LIVE_SORT_LABELS) as LiveSortKey[]).map((k) => (
                        <option key={k} value={k}>
                          {LIVE_SORT_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="lp-chip" onClick={() => saveLivePrefs({ ...livePrefs, dir: livePrefs.dir === "asc" ? "desc" : "asc" })}>
                      <span className="msi" style={{ fontSize: 16 }}>{livePrefs.dir === "asc" ? "arrow_upward" : "arrow_downward"}</span>
                      {livePrefs.dir === "asc" ? "по возрастанию" : "по убыванию"}
                    </button>
                  </div>
                  <label className="lp-toggle">
                    <input type="checkbox" checked={livePrefs.showHidden} onChange={(e) => saveLivePrefs({ ...livePrefs, showHidden: e.target.checked })} />
                    Показать скрытые у меня ({hiddenActiveCount})
                  </label>
                </div>
              </div>
            )}
            {activeAll.length > 0 && activeTrackings.length === 0 && (
              <div className="market-placeholder">Все активные отслеживания скрыты вашими настройками выше.</div>
            )}
            {activeTrackings.length > 0 && (
              <>
                <div className="section-heading">Активные отслеживания{activeTrackings.length !== activeAll.length ? ` (${activeTrackings.length} из ${activeAll.length})` : ` (${activeAll.length})`}</div>
                <div className="live-tracking-list">
                  {activeTrackings.map((t) => (
                    <TrackingCard
                      key={t.id}
                      t={t}
                      busy={busyId === t.id}
                      onStop={() => stopTracking(t.id)}
                      onRemove={() => removeTracking(t.id)}
                      onEdit={() => openEditModal(t)}
                      perms={perms}
                      visibleBooks={myBooks}
                      hiddenForMe={hiddenSet.has(t.id)}
                      onToggleHide={() => toggleHidden(t.id)}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="market-tabs market-tabs-block" style={{ marginBottom: 12 }}>
              <button type="button" className={`view-tab${sportSlug === "football" ? " view-tab-active" : ""}`} onClick={() => setSportSlug("football")}>
                Футбол
              </button>
              <button type="button" className={`view-tab${sportSlug === "hockey" ? " view-tab-active" : ""}`} onClick={() => setSportSlug("hockey")}>
                Хоккей
              </button>
              <button type="button" className={`view-tab${sportSlug === "tennis" ? " view-tab-active" : ""}`} onClick={() => setSportSlug("tennis")}>
                Теннис
              </button>
            </div>

            {perms.live_tracking_join_already_live && !liveMatchesLoading && filteredLiveMatches.length > 0 && (
              <>
                <div className="section-heading live-matches-heading">
                  <span className="live-matches-heading-dot" />
                  Лайв матчи
                </div>
                <div className="live-match-list">
                  {filteredLiveMatches.map((m) => (
                    <div key={m.id} className="live-match-row live-match-row-live">
                      <div className="live-match-row-main">
                        <div className="live-match-row-teams">
                          {m.homeTeam} — {m.awayTeam}
                          {m.scoreHome != null && m.scoreAway != null && (
                            <span className="live-match-row-score">
                              {m.scoreHome} : {m.scoreAway}
                            </span>
                          )}
                          {m.scoreDetail && <span className="live-match-row-detail">{m.scoreDetail}</span>}
                        </div>
                        <div className="live-match-row-meta">
                          {m.league}
                          {m.matchMinute != null && sportSlug !== "tennis" ? ` · ${m.matchMinute}-я мин.` : ""} · начало {formatDateTime(m.kickoffAt)}
                        </div>
                      </div>
                      <button type="button" className="settings-apply-btn settings-apply-btn-active" onClick={() => setTrackModalMatchId(m.id)}>
                        <span className="msi">sensors</span>
                        Отслеживать
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="live-match-picker-header">
              <div className="section-heading">Выбрать матч для отслеживания</div>
              <div className="view-tabs live-league-scope-tabs">
                <button
                  type="button"
                  className={`view-tab${!showAllLeagues ? " view-tab-active" : ""}`}
                  onClick={() => setShowAllLeagues(false)}
                >
                  Топ
                </button>
                <button
                  type="button"
                  className={`view-tab${showAllLeagues ? " view-tab-active" : ""}`}
                  onClick={() => setShowAllLeagues(true)}
                >
                  Все
                </button>
              </div>
            </div>
            <div className="search-wrap live-match-search-wrap">
              <span className="msi search-icon">search</span>
              <input
                className="search-input"
                type="text"
                placeholder="Найти команду или лигу"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {matchesLoading && matches.length === 0 ? (
              <div className="market-placeholder"><Loader label="Загрузка матчей…" size={105} /></div>
            ) : matchesLoadFailed && matches.length === 0 ? (
              <div className="market-placeholder">
                Не удалось загрузить список матчей (сбой сети или сервера) - страница сама повторит попытку через
                минуту, можно также переключить вкладку Футбол/Хоккей, чтобы обновить сейчас.
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="market-placeholder">
                {showAllLeagues
                  ? "Нет подходящих матчей в ближайшее время (нужны коэффициенты Book A - без них отслеживание невозможно)."
                  : "Нет подходящих матчей среди топ-лиг в ближайшее время (нужны коэффициенты Book A - без них отслеживание невозможно)."}
              </div>
            ) : (
              <div className="live-match-list">
                {filteredMatches.map((m) => (
                  <div key={m.id} className="live-match-row">
                    <div className="live-match-row-main">
                      <div className="live-match-row-teams">
                        {m.homeTeam} — {m.awayTeam}
                      </div>
                      <div className="live-match-row-meta">
                        {m.league} · {formatDateTime(m.kickoffAt)}
                      </div>
                    </div>
                    {perms.live_tracking_start && (
                      <button type="button" className="settings-apply-btn settings-apply-btn-active" onClick={() => setTrackModalMatchId(m.id)}>
                        <span className="msi">sensors</span>
                        Отслеживать
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {trackModalMatchId &&
        (() => {
          const m = matches.find((x) => x.id === trackModalMatchId) ?? liveMatches.find((x) => x.id === trackModalMatchId);
          if (!m) return null;
          const isTennisMatch = sportSlug === "tennis";
          const availableAdapters = LIVE_ADAPTER_SLUGS.filter((slug) => m.bookmakerSlugs.includes(slug) && (!isTennisMatch || TENNIS_LIVE_ADAPTER_SLUGS.includes(slug)));
          const availableCrypto = isTennisMatch ? [] : CRYPTO_LIVE_ADAPTER_SLUGS.filter((slug) => m.bookmakerSlugs.includes(slug));
          const selected = selectedBookmakers[m.id] ?? new Set([MANDATORY_LIVE_ADAPTER]);
          const allOn = availableAdapters.every((slug) => selected.has(slug));
          const allCryptoOn = availableCrypto.every((slug) => selected.has(slug));
          const detailLevel = selectedDetailLevel[m.id] ?? DEFAULT_LIVE_DETAIL_LEVEL;
          return (
            <div className="modal-backdrop" onClick={() => setTrackModalMatchId(null)}>
              <div className="modal-box track-modal-box" role="dialog" aria-modal="true" aria-label="Настройки отслеживания" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">
                    Отслеживать: {m.homeTeam} — {m.awayTeam}
                  </div>
                  <button type="button" className="modal-close" onClick={() => setTrackModalMatchId(null)} aria-label="Закрыть">
                    <span className="msi">close</span>
                  </button>
                </div>
                <div className="modal-body">
                  {m.isLive && (
                    <div className="live-late-join-note">
                      <span className="msi">info</span>
                      Матч уже идёт{m.matchMinute != null ? ` (${m.matchMinute}-я мин.` : " ("}
                      {m.scoreHome != null && m.scoreAway != null ? `, счёт ${m.scoreHome}:${m.scoreAway})` : ")"} - отслеживание начнётся не с
                      начала матча, отчёт будет содержать предупреждение об этом.
                    </div>
                  )}
                  <BookmakerFold summary={`Выбрано: ${selected.size}`}><div className="live-bookmaker-columns">
                  <div className="live-bookmaker-col">
                  <div className="section-heading" style={{ marginTop: 0 }}>
                    Конторы
                  </div>
                  <div className="live-bookmaker-picker">
                    {availableAdapters.map((slug) => {
                      const isLocked = slug === MANDATORY_LIVE_ADAPTER;
                      const isOn = selected.has(slug);
                      return (
                        <button
                          key={slug}
                          type="button"
                          className={`live-bookmaker-chip${isOn && !isLocked ? " live-bookmaker-chip-on" : ""}${isLocked ? " live-bookmaker-chip-locked" : ""}`}
                          disabled={isLocked}
                          onClick={() => toggleBookmaker(m.id, slug)}
                          title={
                            isLocked
                              ? "Book A обязателен - без него отслеживание невозможно"
                              : isOn
                                ? `Не отслеживать ${LIVE_ADAPTER_DISPLAY[slug]}`
                                : `Отслеживать ${LIVE_ADAPTER_DISPLAY[slug]}`
                          }
                        >
                          <span className="msi live-bookmaker-chip-icon">{isLocked ? "lock" : isOn ? "check_circle" : "radio_button_unchecked"}</span>
                          {LIVE_ADAPTER_DISPLAY[slug]}
                        </button>
                      );
                    })}
                    {availableAdapters.length > 2 && (
                      <button
                        type="button"
                        className="live-bookmaker-picker-toggle-all"
                        onClick={() => toggleAllBookmakers(m.id, availableAdapters, allOn)}
                      >
                        {allOn ? "Снять все" : "Выбрать все"}
                      </button>
                    )}
                  </div>
                  </div>
                  {availableCrypto.length > 0 && (
                    <div className="live-bookmaker-col live-bookmaker-col-crypto">
                      <div className="section-heading" style={{ marginTop: 0 }}>
                        Крипто
                      </div>
                      <div className="live-bookmaker-picker">
                        {availableCrypto.map((slug) => {
                          const isOn = selected.has(slug);
                          return (
                            <button
                              key={slug}
                              type="button"
                              className={`live-bookmaker-chip${isOn ? " live-bookmaker-chip-on" : ""}`}
                              onClick={() => toggleBookmaker(m.id, slug)}
                              title={isOn ? `Не отслеживать ${CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}` : `Отслеживать ${CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}`}
                            >
                              <span className="msi live-bookmaker-chip-icon">{isOn ? "check_circle" : "radio_button_unchecked"}</span>
                              {CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}
                            </button>
                          );
                        })}
                        {availableCrypto.length > 1 && (
                          <button
                            type="button"
                            className="live-bookmaker-picker-toggle-all"
                            onClick={() => toggleAllCrypto(m.id, availableCrypto, allCryptoOn)}
                          >
                            {allCryptoOn ? "Снять все" : "Выбрать все"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  </div></BookmakerFold>

                  <div className="section-heading">Подробность отчёта</div>
                  <DetailLevelList level={detailLevel} onChange={(level) => setSelectedDetailLevel((prev) => ({ ...prev, [m.id]: level }))} />

                  <button
                    type="button"
                    className="settings-apply-btn settings-apply-btn-active track-modal-confirm"
                    disabled={busyId === m.id}
                    onClick={() => startTracking(m.id)}
                  >
                    <span className="msi">sensors</span>
                    Начать отслеживание
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {editSelection &&
        (() => {
          const s = editSelection;
          // Показываем ВСЕ живые адаптеры, не только те, что точно покрывают этот матч
          const allOn = PARSED_REGULAR.every((slug) => s.bookmakers.has(slug));
          const allCryptoOn = PARSED_CRYPTO.every((slug) => s.bookmakers.has(slug));
          return (
            <div className="modal-backdrop" onClick={() => setEditSelection(null)}>
              <div className="modal-box track-modal-box" role="dialog" aria-modal="true" aria-label="Настройки отслеживания" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">
                    Изменить: {s.homeTeam} — {s.awayTeam}
                  </div>
                  <button type="button" className="modal-close" onClick={() => setEditSelection(null)} aria-label="Закрыть">
                    <span className="msi">close</span>
                  </button>
                </div>
                <div className="modal-body">
                  <BookmakerFold summary={`Выбрано: ${s.bookmakers.size}`}><div className="live-bookmaker-columns">
                  <div className="live-bookmaker-col">
                  <div className="section-heading" style={{ marginTop: 0 }}>
                    Конторы
                  </div>
                  <div className="live-bookmaker-picker">
                    {PARSED_REGULAR.map((slug) => {
                      const isLocked = slug === MANDATORY_LIVE_ADAPTER;
                      const isOn = s.bookmakers.has(slug);
                      return (
                        <button
                          key={slug}
                          type="button"
                          className={`live-bookmaker-chip${isOn && !isLocked ? " live-bookmaker-chip-on" : ""}${isLocked ? " live-bookmaker-chip-locked" : ""}`}
                          disabled={isLocked}
                          onClick={() => toggleEditBookmaker(slug)}
                          title={
                            isLocked
                              ? "Book A обязателен - без него отслеживание невозможно"
                              : isOn
                                ? `Не отслеживать ${LIVE_ADAPTER_DISPLAY[slug]}`
                                : `Отслеживать ${LIVE_ADAPTER_DISPLAY[slug]}`
                          }
                        >
                          <span className="msi live-bookmaker-chip-icon">{isLocked ? "lock" : isOn ? "check_circle" : "radio_button_unchecked"}</span>
                          {LIVE_ADAPTER_DISPLAY[slug]}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="live-bookmaker-picker-toggle-all"
                      onClick={() =>
                        setEditSelection((prev) =>
                          prev
                            ? {
                                ...prev,
                                bookmakers: new Set([
                                  ...(allOn ? [MANDATORY_LIVE_ADAPTER] : PARSED_REGULAR),
                                  ...[...prev.bookmakers].filter((x) => isCryptoLiveAdapterSlug(x)),
                                ]),
                              }
                            : prev
                        )
                      }
                    >
                      {allOn ? "Снять все" : "Выбрать все"}
                    </button>
                  </div>
                  </div>
                  {true && (
                    <div className="live-bookmaker-col live-bookmaker-col-crypto">
                      <div className="section-heading" style={{ marginTop: 0 }}>
                        Крипто
                      </div>
                      <div className="live-bookmaker-picker">
                        {PARSED_CRYPTO.map((slug) => {
                          const isOn = s.bookmakers.has(slug);
                          return (
                            <button
                              key={slug}
                              type="button"
                              className={`live-bookmaker-chip${isOn ? " live-bookmaker-chip-on" : ""}`}
                              onClick={() => toggleEditBookmaker(slug)}
                              title={isOn ? `Не отслеживать ${CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}` : `Отслеживать ${CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}`}
                            >
                              <span className="msi live-bookmaker-chip-icon">{isOn ? "check_circle" : "radio_button_unchecked"}</span>
                              {CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}
                            </button>
                          );
                        })}
                        {(
                          <button
                            type="button"
                            className="live-bookmaker-picker-toggle-all"
                            onClick={() =>
                              setEditSelection((prev) => {
                                if (!prev) return prev;
                                const next = new Set([...prev.bookmakers].filter((x) => !isCryptoLiveAdapterSlug(x)));
                                if (!allCryptoOn) for (const x of PARSED_CRYPTO) next.add(x);
                                return { ...prev, bookmakers: next };
                              })
                            }
                          >
                            {allCryptoOn ? "Снять все" : "Выбрать все"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  </div></BookmakerFold>

                  <div className="section-heading">Подробность отчёта</div>
                  <DetailLevelList level={s.detailLevel} onChange={(level) => setEditSelection((prev) => (prev ? { ...prev, detailLevel: level } : prev))} />

                  <button
                    type="button"
                    className="settings-apply-btn settings-apply-btn-active track-modal-confirm"
                    disabled={busyId === s.trackingId}
                    onClick={updateTracking}
                  >
                    <span className="msi">check</span>
                    Сохранить изменения
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}

// Время матча до секунд трекер пишет секунды таймера раз в опрос
function LiveClock({ minute, seconds }: { minute: number | null; seconds: number | null }) {
  const [base, setBase] = useState<{ sec: number; at: number; running: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sec = seconds ?? (minute != null ? minute * 60 : null);
    if (sec == null) {
      setBase(null);
      return;
    }
    setBase((prev) => ({ sec, at: Date.now(), running: prev ? sec !== prev.sec : true }));
  }, [seconds, minute]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!base) return null;
  const add = base.running ? Math.min(12, Math.max(0, Math.floor((now - base.at) / 1000))) : 0;
  const total = base.sec + add;
  return (
    <span className="live-card-minute">
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}
    </span>
  );
}

function TrackingCard({
  t,
  busy,
  onStop,
  onRemove,
  onEdit,
  perms,
  visibleBooks,
  hiddenForMe,
  onToggleHide,
}: {
  t: Tracking;
  busy: boolean;
  onStop: () => void;
  onRemove: () => void;
  onEdit?: () => void;
  perms: BetmarkPerms;
  visibleBooks?: BookFilter;
  hiddenForMe?: boolean;
  onToggleHide?: () => void;
}) {
  // конторы, которые пользователь выбрал для себя в настройках списка (null - все)
  const visOdds = visibleOdds(t, visibleBooks ?? null);
  const canStop = (t.status === "SCHEDULED" || t.status === "TRACKING") && perms.live_tracking_stop;
  const canRemove = t.status !== "TRACKING" && perms.live_tracking_remove;
  // Изменить конторы/подробность можно только пока матч ещё не начался
  const canEdit = t.status === "SCHEDULED" && !!onEdit && perms.live_tracking_edit;

  const liveCard = t.status === "TRACKING";
  // Калькулятор вилки берёт текущие кэфы контор с карточки; у кого цены нет - в расчёт не попадает
  const [calcOpen, setCalcOpen] = useState(false);
  const calcMatch: CalcMatch = {
    homeTeam: t.homeTeam,
    awayTeam: t.awayTeam,
    bookmakers: visOdds
      .filter((o) => !o.unavailable)
      .map((o) => ({
        slug: o.slug,
        name: (LIVE_ADAPTER_DISPLAY as Record<string, string>)[o.slug] ?? (CRYPTO_LIVE_ADAPTER_DISPLAY as Record<string, string>)[o.slug] ?? o.slug,
        odds: { "1": o.price1, X: o.priceX, "2": o.price2 },
      })),
  };
  // Лучшая цена по каждому исходу среди контор, у которых она сейчас есть, и Payout по ним
  const priced = visOdds.filter((o) => !o.unavailable);
  const bestOf = (k: "price1" | "priceX" | "price2"): number | null => {
    const vs = priced.map((o) => o[k]).filter((v): v is number => v != null && v > 1);
    return vs.length ? Math.max(...vs) : null;
  };
  const bestPrices = [bestOf("price1"), bestOf("priceX"), bestOf("price2")];
  const hasDraw = t.sport !== "tennis";
  const [b1, bX, b2] = bestPrices;
  const payout = b1 && b2 && (!hasDraw || bX) ? 100 / (1 / b1 + 1 / b2 + (hasDraw && bX ? 1 / bX : 0)) : null;

  return (
    <div className={liveCard ? "live-tracking-card live-card" : "live-tracking-card"}>
      {liveCard ? (
        <>
          <div className="live-card-head">
            <span className="live-card-badge">
              <i /> LIVE
            </span>
            <LiveClock minute={t.matchMinute} seconds={t.matchTimerSeconds ?? null} />
            {t.source === "autoscan" && <span className="live-card-src" title="Поставлено автоматически: сервер сканирует все идущие топ-матчи">автоскан</span>}
            <span className="live-card-league">
              {SPORT_LABELS[t.sport] ?? t.sport}
              {t.league ? ` · ${t.league}` : ""}
            </span>
          </div>
          <div className="live-card-score">
            <span>{t.homeTeam}</span>
            <b>{t.scoreHome !== null && t.scoreAway !== null ? `${t.scoreHome} : ${t.scoreAway}` : "– : –"}</b>
            <span>{t.awayTeam}</span>
          </div>
          {t.sport === "tennis" && t.scoreDetail && <div className="live-card-detail" title="Геймы по сетам и очки текущего гейма">{t.scoreDetail}</div>}
          {visOdds.length > 0 ? (
            <div className="live-card-rows">
              <div className="live-card-row live-card-row-head">
                <span />
                <span>1</span>
                <span>{t.sport === "tennis" ? "" : "X"}</span>
                <span>2</span>
              </div>
              {visOdds.map((o) => (
                <div className="live-card-row" key={o.slug}>
                  <span className="live-card-book">
                    {(LIVE_ADAPTER_DISPLAY as Record<string, string>)[o.slug] ?? (CRYPTO_LIVE_ADAPTER_DISPLAY as Record<string, string>)[o.slug] ?? o.slug}
                  </span>
                  {o.unavailable ? (
                    [0, 1, 2].map((i) => (
                      <span className="live-card-price is-empty" key={i} title="Контора нашла матч, но коэффициентов сейчас нет">
                        —*
                      </span>
                    ))
                  ) : (
                    ([
                      [o.price1, o.t1],
                      [o.priceX, o.tX],
                      [o.price2, o.t2],
                    ] as [number | null, "up" | "down" | null][]).map(([v, tr], idx) => (
                      <span className={`live-card-price${tr ? ` is-${tr}` : ""}${v != null && v === bestPrices[idx] ? " is-best" : ""}${v == null ? " is-empty" : ""}`} key={idx}>
                        {v != null ? v.toFixed(2) : t.sport === "tennis" && idx === 1 ? "" : "—"}
                        {tr && <em>{tr === "up" ? "▲" : "▼"}</em>}
                      </span>
                    ))
                  )}
                </div>
              ))}
              {payout !== null && (
                <div className="live-card-payout">
                  <span>Payout по лучшим кэфам</span>
                  <b className={payout > 100 ? "is-arb" : ""}>{payout.toFixed(1)}%</b>
                </div>
              )}
            </div>
          ) : (
            <div className="live-card-empty">Коэффициенты появятся после первого опроса контор.</div>
          )}
        </>
      ) : (
        <>
      <div className="live-tracking-card-top">
        <span className={`live-badge ${STATUS_CLASS[t.status]}`}>{STATUS_LABELS[t.status]}</span>
        <span className="live-tracking-card-sport">{SPORT_LABELS[t.sport] ?? t.sport}</span>
      </div>
      <div className="live-tracking-card-teams">
        {t.homeTeam} — {t.awayTeam}
        {(t.status === "TRACKING" || t.status === "FINISHED") && t.scoreHome !== null && t.scoreAway !== null && (
          <span className="live-tracking-card-score">
            {t.scoreHome} : {t.scoreAway}
            {t.sport === "tennis" && t.scoreDetail && <span className="live-tracking-card-minute">{t.scoreDetail}</span>}
            {t.sport !== "tennis" && t.status === "TRACKING" && t.matchMinute !== null && (
              <span className="live-tracking-card-minute">{formatMinute(t.matchMinute)}</span>
            )}
          </span>
        )}
      </div>
        </>
      )}
      <div className="live-tracking-card-meta">
        {t.league} · начало {formatDateTime(t.kickoffAt)}
        {t.bookmakerSlugs.length > 0 && (
          <>
            {" · "}
            {t.bookmakerSlugs.length < LIVE_ADAPTER_SLUGS.length ? (
              <span className="waiting-card-count-badge">{t.bookmakerSlugs.length}</span>
            ) : (
              t.bookmakerSlugs.length
            )}{" "}
            {pluralRu(t.bookmakerSlugs.length, "контора", "конторы", "контор")}
            {(t.status === "TRACKING" || t.status === "FINISHED") &&
              t.actualBookmakerCount > 0 &&
              t.actualBookmakerCount < t.bookmakerSlugs.length && (
                <span className="live-tracking-card-actual-count">{" "}({t.actualBookmakerCount})</span>
              )}
          </>
        )}
      </div>
      {LIVE_DETAIL_LEVEL_CONFIG[t.detailLevel] && (
        <div className="live-tracking-card-detail">
          {LIVE_DETAIL_LEVEL_CONFIG[t.detailLevel].label}
        </div>
      )}

      <div className="live-tracking-card-actions">
        {((t.hasReport && perms.reports_download_final) || (t.status === "TRACKING" && perms.reports_download_live_snapshot)) && (
          <a className="logs-button" href={`/api/live-tracking/${t.id}/report`} target="_blank" rel="noreferrer" title={t.status === "TRACKING" ? "PDF с текущими данными" : undefined}>
            <span className="msi">download</span>
            {t.status === "TRACKING" ? "PDF" : t.hasReportRaw ? "Отчёт PDF (с ИИ)" : "Отчёт PDF"}
          </a>
        )}
        {t.hasReportRaw && perms.reports_download_final && perms.live_tracking_choose_ultra && (
          <a className="logs-button" href={`/api/live-tracking/${t.id}/report?variant=raw`} target="_blank" rel="noreferrer">
            <span className="msi">download</span>
            Отчёт PDF (без ИИ)
          </a>
        )}
        {canEdit && (
          <button type="button" className="logs-button" disabled={busy} onClick={onEdit}>
            <span className="msi">edit</span>
            Изменить
          </button>
        )}
        {onToggleHide && (
          <button type="button" className="logs-button logs-button-icon" onClick={onToggleHide} title={hiddenForMe ? "Вернуть в мой список" : "Скрыть у меня (у других пользователей матч останется)"} aria-label={hiddenForMe ? "Вернуть в мой список" : "Скрыть у меня"}>
            <span className="msi">{hiddenForMe ? "visibility" : "visibility_off"}</span>
          </button>
        )}
        {liveCard && calcMatch.bookmakers.length > 0 && (
          <button type="button" className="logs-button logs-button-icon" onClick={() => setCalcOpen(true)} title="Калькулятор вилки" aria-label="Калькулятор вилки">
            <span className="msi">calculate</span>
          </button>
        )}
        {canStop && (
          <button type="button" className="logs-button" disabled={busy} onClick={onStop}>
            <span className="msi">stop_circle</span>
            Остановить
          </button>
        )}
        {canRemove && (
          <button type="button" className="logs-button" disabled={busy} onClick={onRemove}>
            <span className="msi">delete</span>
            Убрать из списка
          </button>
        )}
      </div>
      {calcOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <SurebetCalculatorModal match={calcMatch} sportSlug={t.sport} hiddenBookmakers={new Set<string>()} onClose={() => setCalcOpen(false)} />,
          document.body
        )}
    </div>
  );
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

interface AutoTrackEntry {
  sportSlug: "football" | "hockey";
  leagueKey: string;
  config: { active: boolean; bookmakerSlugs: string[]; detailLevel: LiveDetailLevel } | null;
}

interface AutoTrackWaitingMatch {
  matchId: string;
  sportSlug: "football" | "hockey";
  leagueKey: string;
  home: string;
  away: string;
  kickoffAt: string;
  bookmakerCount: number;
  hasBooka: boolean;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function formatWaitingCountdown(kickoffAt: string, nowMs: number): string {
  const diffMs = new Date(kickoffAt).getTime() - nowMs;
  if (diffMs <= 0) {
    const minsAgo = Math.round(-diffMs / 60000);
    return minsAgo <= 0 ? "начинается прямо сейчас" : `начался ${minsAgo} мин назад · ждём live у Book A`;
  }
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `через ${mins} мин`;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 24) return restMins === 0 ? `через ${hours} ч` : `через ${hours} ч ${restMins} мин`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  const daysLabel = pluralRu(days, "день", "дня", "дней");
  return restHours === 0 ? `через ${days} ${daysLabel}` : `через ${days} ${daysLabel} ${restHours} ч`;
}

const WAITING_RANGE_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "3 часа", hours: 3 },
  { label: "6 часов", hours: 6 },
  { label: "12 часов", hours: 12 },
  { label: "24 часа", hours: 24 },
  { label: "48 часов", hours: 48 },
  { label: "Все", hours: null },
];

function AutoTrackWaitingList() {
  const [waiting, setWaiting] = useState<AutoTrackWaitingMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [rangeHours, setRangeHours] = useState<number | null>(24);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auto-track-waiting");
        const data = await res.json();
        if (!cancelled) setWaiting(Array.isArray(data.waiting) ? data.waiting : []);
      } catch {
        // тихо - список ожидания просто не обновится в этом тике, старые данные останутся на экране
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Обратный отсчёт "через X мин" должен идти сам, без ожидания следующего сетевого опроса
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const rangeFiltered =
    rangeHours == null ? waiting : waiting.filter((w) => new Date(w.kickoffAt).getTime() - nowMs <= rangeHours * 3600 * 1000);

  const FULL_BOOKMAKER_COUNT = LIVE_ADAPTER_SLUGS.length;

  const renderGroup = (title: string, sport: "football" | "hockey") => {
    const list = rangeFiltered.filter((w) => w.sportSlug === sport);
    if (list.length === 0) return null;
    const withBooka = list.filter((m) => m.hasBooka);
    const withoutBooka = list.filter((m) => !m.hasBooka);

    const renderCard = (m: AutoTrackWaitingMatch, warn: boolean) => (
      <div key={m.matchId} className={`waiting-card${warn ? " waiting-card-warn" : ""}`}>
        <div className="waiting-card-teams">
          {m.home} - {m.away}
        </div>
        <div className="waiting-card-meta" title={`Начало ${formatDateTime(m.kickoffAt)}`}>
          {m.leagueKey} · {formatWaitingCountdown(m.kickoffAt, nowMs)}
        </div>
        <div className="waiting-card-count">
          {m.bookmakerCount < FULL_BOOKMAKER_COUNT ? (
            <span className="waiting-card-count-badge">{m.bookmakerCount}</span>
          ) : (
            m.bookmakerCount
          )}{" "}
          {m.bookmakerCount === 1 ? "контора" : "контор"}
        </div>
      </div>
    );

    return (
      <div key={sport}>
        <div className="section-heading" style={{ marginTop: 10, marginBottom: 6 }}>
          {title} ({list.length})
        </div>
        {withBooka.length > 0 && <div className="waiting-grid">{withBooka.map((m) => renderCard(m, false))}</div>}
        {withoutBooka.length > 0 && (
          <>
            <div className="waiting-subheading" title="Без Book A автослежение не может определить момент начала live - эти карточки так и останутся в ожидании.">
              <span className="msi">warning</span> Без Book A ({withoutBooka.length})
            </div>
            <div className="waiting-grid">{withoutBooka.map((m) => renderCard(m, true))}</div>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="section-heading waiting-heading" style={{ marginTop: 0, marginBottom: 6 }}>
        Список ожидания{rangeFiltered.length > 0 ? ` (${rangeFiltered.length})` : ""}
        <span
          className="waiting-info-icon"
          title="Матчи включённых ниже лиг, которые ещё не идут live. Как только Book A покажет матч в эфире, отслеживание поставится автоматически - карточка исчезнет отсюда и появится во вкладке «Матчи» → «Активные отслеживания»."
        >
          <span className="msi">info</span>
        </span>
      </div>
      <div className="waiting-range-picker">
        {WAITING_RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`waiting-range-chip${rangeHours === opt.hours ? " waiting-range-chip-on" : ""}`}
            onClick={() => setRangeHours(opt.hours)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="market-placeholder"><Loader label="Загрузка списка ожидания…" size={105} /></div>
      ) : waiting.length === 0 ? (
        <div className="market-placeholder">
          Пока никто не ждёт - либо у включённых лиг нет ближайших матчей, либо все они уже live.
        </div>
      ) : rangeFiltered.length === 0 ? (
        <div className="market-placeholder">В выбранном диапазоне времени пока никого нет - попробуйте диапазон шире.</div>
      ) : (
        <>
          {renderGroup("Футбол", "football")}
          {renderGroup("Хоккей", "hockey")}
        </>
      )}
    </>
  );
}

function AutoTrackPanel({ perms }: { perms: BetmarkPerms }) {
  const isParsedBook = useParsedBooks();
  const PARSED_REGULAR = LIVE_ADAPTER_SLUGS.filter(isParsedBook);
  const PARSED_CRYPTO = CRYPTO_LIVE_ADAPTER_SLUGS.filter(isParsedBook);
  const [entries, setEntries] = useState<AutoTrackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<{
    sportSlug: "football" | "hockey";
    leagueKey: string;
    bookmakers: Set<string>;
    detailLevel: LiveDetailLevel;
  } | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/auto-track-leagues");
      const data = await res.json();
      setEntries(Array.isArray(data.leagues) ? data.leagues : []);
    } catch {
      // тихо - панель просто останется пустой/со старыми данными, не блокирует остальную страницу /live
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveConfig(payload: { sportSlug: string; leagueKey: string; active: boolean; bookmakers?: string[]; detailLevel?: LiveDetailLevel }) {
    const key = `${payload.sportSlug}:${payload.leagueKey}`;
    setBusyKey(key);
    try {
      await fetch("/api/auto-track-leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  function openEnableModal(entry: AutoTrackEntry) {
    setEditEntry({
      sportSlug: entry.sportSlug,
      leagueKey: entry.leagueKey,
      bookmakers: new Set(entry.config?.bookmakerSlugs ?? [MANDATORY_LIVE_ADAPTER]),
      detailLevel: entry.config?.detailLevel ?? DEFAULT_LIVE_DETAIL_LEVEL,
    });
  }

  function toggleEditBookmaker(slug: string) {
    setEditEntry((prev) => {
      if (!prev || slug === MANDATORY_LIVE_ADAPTER) return prev;
      const next = new Set(prev.bookmakers);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, bookmakers: next };
    });
  }

  async function confirmEnable() {
    if (!editEntry) return;
    await saveConfig({
      sportSlug: editEntry.sportSlug,
      leagueKey: editEntry.leagueKey,
      active: true,
      bookmakers: [...editEntry.bookmakers],
      detailLevel: editEntry.detailLevel,
    });
    setEditEntry(null);
  }

  if (!perms.auto_track_view) return <div className="market-placeholder">У вашего аккаунта нет доступа к этому разделу.</div>;
  if (loading) return <div className="market-placeholder"><Loader label="Загрузка автослежения…" size={105} /></div>;

  const renderGroup = (title: string, sport: "football" | "hockey") => {
    const list = entries.filter((e) => e.sportSlug === sport);
    if (list.length === 0) return null;
    return (
      <>
        <div className="section-heading">{title}</div>
        <div className="auto-track-list">
          {list.map((entry) => {
            const key = `${entry.sportSlug}:${entry.leagueKey}`;
            const isOn = entry.config?.active ?? false;
            return (
              <div key={key} className="auto-track-row">
                <span className="auto-track-row-name">{entry.leagueKey}</span>
                <span className="auto-track-row-meta">
                  {isOn && entry.config
                    ? `${entry.config.bookmakerSlugs.length} контор · ${LIVE_DETAIL_LEVEL_CONFIG[entry.config.detailLevel].label}`
                    : "выключено"}
                </span>
                {isOn && perms.auto_track_edit && (
                  <button
                    type="button"
                    className="auto-track-edit-btn"
                    onClick={() => openEnableModal(entry)}
                    title="Изменить настройки автослежения"
                    aria-label={`Изменить настройки автослежения ${entry.leagueKey}`}
                  >
                    <span className="msi">tune</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`auto-track-toggle${isOn ? " auto-track-toggle-on" : ""}`}
                  disabled={busyKey === key || !perms.auto_track_edit}
                  onClick={() => (isOn ? saveConfig({ sportSlug: entry.sportSlug, leagueKey: entry.leagueKey, active: false }) : openEnableModal(entry))}
                  aria-label={isOn ? `Выключить автослежение ${entry.leagueKey}` : `Включить автослежение ${entry.leagueKey}`}
                  title={!perms.auto_track_edit ? "Нет права управлять автоотслеживанием" : undefined}
                >
                  <span className="auto-track-toggle-knob" />
                </button>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <>
      <div className="section-heading waiting-heading" style={{ marginTop: 24 }}>
        Автослежение по лигам
        <span
          className="waiting-info-icon"
          title="Включённая лига отслеживается сама - как только у неё появляется live-матч, отслеживание ставится автоматически, без нажатия «Отслеживать» вручную."
        >
          <span className="msi">info</span>
        </span>
      </div>
      {renderGroup("Футбол", "football")}
      {renderGroup("Хоккей", "hockey")}

      {editEntry &&
        (() => {
          const allOn = PARSED_REGULAR.every((slug) => editEntry.bookmakers.has(slug));
          const allCryptoOn = PARSED_CRYPTO.every((slug) => editEntry.bookmakers.has(slug));
          const key = `${editEntry.sportSlug}:${editEntry.leagueKey}`;
          return (
            <div className="modal-backdrop" onClick={() => setEditEntry(null)}>
              <div className="modal-box track-modal-box" role="dialog" aria-modal="true" aria-label="Настройки отслеживания" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="modal-title">Автослежение: {editEntry.leagueKey}</div>
                  <button type="button" className="modal-close" onClick={() => setEditEntry(null)} aria-label="Закрыть">
                    <span className="msi">close</span>
                  </button>
                </div>
                <div className="modal-body">
                  <BookmakerFold summary={`Выбрано: ${editEntry.bookmakers.size}`}><div className="live-bookmaker-columns">
                  <div className="live-bookmaker-col">
                  <div className="section-heading" style={{ marginTop: 0 }}>
                    Конторы
                  </div>
                  <div className="live-bookmaker-picker">
                    {PARSED_REGULAR.map((slug) => {
                      const isLocked = slug === MANDATORY_LIVE_ADAPTER;
                      const isOn = editEntry.bookmakers.has(slug);
                      return (
                        <button
                          key={slug}
                          type="button"
                          className={`live-bookmaker-chip${isOn && !isLocked ? " live-bookmaker-chip-on" : ""}${isLocked ? " live-bookmaker-chip-locked" : ""}`}
                          disabled={isLocked}
                          onClick={() => toggleEditBookmaker(slug)}
                          title={
                            isLocked
                              ? "Book A обязателен - без него отслеживание невозможно"
                              : isOn
                                ? `Не отслеживать ${LIVE_ADAPTER_DISPLAY[slug]}`
                                : `Отслеживать ${LIVE_ADAPTER_DISPLAY[slug]}`
                          }
                        >
                          <span className="msi live-bookmaker-chip-icon">{isLocked ? "lock" : isOn ? "check_circle" : "radio_button_unchecked"}</span>
                          {LIVE_ADAPTER_DISPLAY[slug]}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="live-bookmaker-picker-toggle-all"
                      onClick={() =>
                        setEditEntry((prev) =>
                          prev
                            ? {
                                ...prev,
                                bookmakers: new Set([
                                  ...(allOn ? [MANDATORY_LIVE_ADAPTER] : PARSED_REGULAR),
                                  ...[...prev.bookmakers].filter((x) => isCryptoLiveAdapterSlug(x)),
                                ]),
                              }
                            : prev
                        )
                      }
                    >
                      {allOn ? "Снять все" : "Выбрать все"}
                    </button>
                  </div>
                  </div>
                  <div className="live-bookmaker-col live-bookmaker-col-crypto">
                    <div className="section-heading" style={{ marginTop: 0 }}>
                      Крипто
                    </div>
                    <div className="live-bookmaker-picker">
                      {PARSED_CRYPTO.map((slug) => {
                        const isOn = editEntry.bookmakers.has(slug);
                        return (
                          <button
                            key={slug}
                            type="button"
                            className={`live-bookmaker-chip${isOn ? " live-bookmaker-chip-on" : ""}`}
                            onClick={() => toggleEditBookmaker(slug)}
                            title={isOn ? `Не отслеживать ${CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}` : `Отслеживать ${CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}`}
                          >
                            <span className="msi live-bookmaker-chip-icon">{isOn ? "check_circle" : "radio_button_unchecked"}</span>
                            {CRYPTO_LIVE_ADAPTER_DISPLAY[slug]}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="live-bookmaker-picker-toggle-all"
                        onClick={() =>
                          setEditEntry((prev) => {
                            if (!prev) return prev;
                            const next = new Set([...prev.bookmakers].filter((x) => !isCryptoLiveAdapterSlug(x)));
                            if (!allCryptoOn) for (const x of PARSED_CRYPTO) next.add(x);
                            return { ...prev, bookmakers: next };
                          })
                        }
                      >
                        {allCryptoOn ? "Снять все" : "Выбрать все"}
                      </button>
                    </div>
                  </div>
                  </div></BookmakerFold>

                  <div className="section-heading">Подробность отчёта</div>
                  <DetailLevelList level={editEntry.detailLevel} onChange={(level) => setEditEntry((prev) => (prev ? { ...prev, detailLevel: level } : prev))} />

                  <button
                    type="button"
                    className="settings-apply-btn settings-apply-btn-active track-modal-confirm"
                    disabled={busyKey === key}
                    onClick={confirmEnable}
                  >
                    <span className="msi">check</span>
                    Включить автослежение
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}
