"use client";

// Сканер вилок Betmark (/forks)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForkCalculator from "./ForkCalculator";
import ForkSettingsPanel from "./ForkSettingsPanel";
import { playForkSound, unlockAudio } from "./sound";
import {
  ageSec,
  linkInfo,
  openLegs,
  copyMatchName,
  compareBy,
  defaultSettings,
  fmtAge,
  fmtKickoff,
  fmtMoney,
  forkProfit,
  matchesFilter,
  netPrice,
  normalizeSettings,
  OUTCOME_LABEL,
  pairKey,
  roiOf,
  sortValue,
  SPORT_ICONS,
  SPORT_LABELS,
  type ForkLeg,
  type ForkRow,
  type ForkSettings,
  type ForksResponse,
  type MatchMeta,
  type SortKey,
} from "@/lib/forks/model";

type Tab = "prematch" | "live" | "all" | "journal" | "hidden" | "settings";
interface Hidden {
  id: string;
  kind: "fork" | "match" | "pair";
  key: string;
  label: string;
  createdAt: string;
}
interface Bet {
  id: string;
  kind: string;
  matchId: string;
  market: string;
  title: string;
  league: string;
  kickoffAt: string | null;
  legs: { slug: string; outcome: string; price: number; stake: number; currency: string; stakeRub: number; net?: number }[];
  totalStakeRub: number;
  expectedProfit: number;
  status: string;
  winOutcome: string | null;
  resultRub: number | null;
  settledBy: string | null;
  note: string;
  createdAt: string;
}
interface BetStats {
  total: number;
  open: number;
  settled: number;
  turnoverRub: number;
  resultRub: number;
  expectedOpenRub: number;
}
interface Group {
  key: string;
  meta: MatchMeta | undefined;
  forks: ForkRow[];
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* приватный режим - не страшно */
  }
};

const COLUMN_SORT: { key: SortKey; label: string }[] = [
  { key: "profit", label: "Доход" },
  { key: "roi", label: "ROI, %/год" },
  { key: "age", label: "Жизнь" },
  { key: "start", label: "Время" },
];

export default function ForksApp() {
  const [tab, setTab] = useState<Tab>(() => (lsGet("fk-tab") as Tab) || "prematch");
  const [settings, setSettings] = useState<ForkSettings>(defaultSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [data, setData] = useState<ForksResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Hidden[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({ RUB: 1 });
  const [ratesDate, setRatesDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // кэфы всех контор матча раскрываются по клику на матч (по умолчанию свёрнуты)
  const [quotesOpen, setQuotesOpen] = useState<Set<string>>(new Set());
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [bets, setBets] = useState<Bet[]>([]);
  const [betStats, setBetStats] = useState<BetStats | null>(null);
  const [clockSkew, setClockSkew] = useState(0);
  const notified = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => lsSet("fk-tab", tab), [tab]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now + clockSkew;

  // загрузка настроек, скрытого, курсов
  useEffect(() => {
    fetch("/api/forks/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSettings(normalizeSettings(j?.data)))
      .catch(() => undefined)
      .finally(() => setSettingsLoaded(true));
    fetch("/api/forks/hidden")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setHidden(j.hidden))
      .catch(() => undefined);
    fetch("/api/forks/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setRates(j.rates || { RUB: 1 });
          setRatesDate(j.date || null);
        }
      })
      .catch(() => undefined);
  }, []);

  const updateSettings = useCallback((s: ForkSettings) => {
    setSettings(s);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/forks/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: s }) });
        setSaveState(r.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    }, 700);
  }, []);

  // опрос вилок
  const minRequested = useMemo(() => {
    const en = settings.filters.filter((f) => f.enabled);
    return en.length ? Math.min(...en.map((f) => f.minProfit)) : 0;
  }, [settings.filters]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/forks?kind=all&minProfit=${encodeURIComponent(String(Math.max(-10, minRequested - 0.01)))}`, { cache: "no-store" });
      if (r.status === 403 || r.status === 401) {
        setLoadError("Нет доступа к сканеру вилок (право «Сканер вилок» в админке).");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ForksResponse;
      setClockSkew(Date.parse(j.serverTime) - Date.now());
      setData(j);
      setLoadError(null);
    } catch (e) {
      setLoadError("Не удалось обновить список: " + (e as Error).message);
    }
  }, [minRequested]);

  useEffect(() => {
    if (!settingsLoaded || paused) return;
    void load();
    const id = setInterval(() => void load(), Math.max(2, settings.refreshSec) * 1000);
    return () => clearInterval(id);
  }, [load, settings.refreshSec, settingsLoaded, paused]);

  const loadBets = useCallback(async () => {
    const r = await fetch("/api/forks/bets").catch(() => null);
    if (r?.ok) {
      const j = await r.json();
      setBets(j.bets);
      setBetStats(j.stats);
    }
  }, []);
  useEffect(() => {
    if (tab === "journal") void loadBets();
  }, [tab, loadBets]);

  // применяем фильтры, скрытое, сортировку
  const hiddenSets = useMemo(() => {
    const s = { fork: new Set<string>(), match: new Set<string>(), pair: new Set<string>() };
    for (const h of hidden) s[h.kind].add(h.key);
    return s;
  }, [hidden]);

  const view = useMemo(() => {
    if (!data) return { groups: [] as Group[], total: 0, matchedIds: new Map<string, string[]>(), all: [] as ForkRow[], counts: { prematch: 0, live: 0 } };
    const matchedIds = new Map<string, string[]>();
    const all: ForkRow[] = []; // прошли фильтры и скрытое (любой вид) - для счётчиков вкладок и звука
    const counts = { prematch: 0, live: 0 };
    for (const f0 of data.forks) {
      if (hiddenSets.fork.has(f0.id) || hiddenSets.match.has(f0.matchId)) continue;
      const meta = data.matches[`${f0.kind}:${f0.matchId}`];
      const names: string[] = [];
      let legs: ForkLeg[] | null = null;
      for (const flt of settings.filters) {
        const r = matchesFilter(f0, flt, { nowMs, meta, settings });
        if (r) {
          names.push(flt.name);
          if (!legs) legs = r; // конторы выбираются по первому сработавшему фильтру
        }
      }
      if (!legs) continue;
      const f: ForkRow = { ...f0, legs, bookmakers: legs.map((l) => l.slug) };
      // скрытая связка: все конторы скрытой связки присутствуют в вилке
      let pairHidden = false;
      for (const p of hiddenSets.pair) {
        const ps = p.split("+");
        if (ps.every((x) => f.bookmakers.includes(x))) {
          pairHidden = true;
          break;
        }
      }
      if (pairHidden) continue;
      matchedIds.set(f.id, names);
      all.push(f);
      counts[f.kind]++;
    }
    const list = all.filter((f) => tab === "all" || tab === f.kind || (tab !== "prematch" && tab !== "live"));
    const bkCount = (f: ForkRow) => Object.values(data.matches[`${f.kind}:${f.matchId}`]?.allQuotes ?? {})[0]?.length ?? f.legs.length;
    const getVal = (key: SortKey, f: ForkRow) => sortValue(key, f, data.matches[`${f.kind}:${f.matchId}`], settings, nowMs, bkCount(f));
    const cmp = compareBy(settings.sort, getVal);
    list.sort(cmp);
    const groups: Group[] = [];
    if (settings.groupByMatch) {
      const byKey = new Map<string, Group>();
      for (const f of list) {
        const k = `${f.kind}:${f.matchId}`;
        let g = byKey.get(k);
        if (!g) {
          g = { key: k, meta: data.matches[k], forks: [] };
          byKey.set(k, g);
          groups.push(g);
        }
        g.forks.push(f);
      }
    } else for (const f of list) groups.push({ key: f.id, meta: data.matches[`${f.kind}:${f.matchId}`], forks: [f] });
    return { groups: groups.slice(0, settings.display.maxGroups), total: list.length, matchedIds, all, counts };
  }, [data, tab, hiddenSets, settings, nowMs]);

  // звук новой вилки
  useEffect(() => {
    if (!data) return;
    const fresh: ForkRow[] = [];
    for (const f of view.all) {
      if (notified.current.has(f.id)) continue;
      notified.current.add(f.id);
      if (!firstLoad.current && settings.sound.enabled && settings.sound.kinds.includes(f.kind) && forkProfit(f, settings) >= settings.sound.minProfit) fresh.push(f);
    }
    if (fresh.length) playForkSound(settings.sound.tone, settings.sound.volume);
    firstLoad.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const names = data?.bookmakers ?? {};
  // в калькулятор идёт вилка с конторами, выбранными по вашим фильтрам (с учётом клонов)
  const selectedFork = useMemo(() => (selected ? view.all.find((f) => f.id === selected) ?? null : null), [selected, view.all]);
  // выбранная вилка пропала из сканера - держим последнюю версию, чтобы калькулятор не закрывался посреди ставки
  const lastSelected = useRef<ForkRow | null>(null);
  if (selectedFork) lastSelected.current = selectedFork;
  const calcFork = selected ? selectedFork ?? lastSelected.current : null;
  const calcGone = !!selected && !selectedFork;

  async function hide(kind: Hidden["kind"], key: string, label: string) {
    setMenuFor(null);
    const r = await fetch("/api/forks/hidden", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, key, label }) }).catch(() => null);
    if (r?.ok) {
      const j = await r.json();
      setHidden((h) => [j.hidden, ...h.filter((x) => x.id !== j.hidden.id)]);
    }
  }
  async function unhide(id?: string) {
    await fetch(id ? `/api/forks/hidden?id=${encodeURIComponent(id)}` : "/api/forks/hidden?all=1", { method: "DELETE" }).catch(() => null);
    setHidden((h) => (id ? h.filter((x) => x.id !== id) : []));
  }
  async function settle(id: string, body: Record<string, unknown>) {
    await fetch(`/api/forks/bets/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    void loadBets();
  }
  async function delBet(id: string) {
    if (!confirm("Удалить ставку из журнала?")) return;
    await fetch(`/api/forks/bets/${id}`, { method: "DELETE" }).catch(() => null);
    void loadBets();
  }

  const scannerAge = (kind: string) => {
    const t = data?.scanner?.[kind];
    return t ? (nowMs - Date.parse(t)) / 1000 : null;
  };
  const toggleSort = (key: SortKey) => {
    const cur = settings.sort[0];
    const dir: "asc" | "desc" = cur?.key === key ? (cur.dir === "desc" ? "asc" : "desc") : key === "start" || key === "age" ? "asc" : "desc";
    updateSettings({ ...settings, sort: [{ key, dir }, ...settings.sort.filter((s) => s.key !== key)].slice(0, 5) });
  };
  const counts = view.counts; // вилки, прошедшие ваши фильтры и скрытое

  const renderLegs = (f: ForkRow, meta: MatchMeta | undefined) => (
    <div className="fk-legs">
      {f.legs.map((l) => {
        const net = netPrice(l.slug, l.price, settings);
        const pAge = (nowMs - Date.parse(l.confirmedAt)) / 1000;
        return (
          <div className="fk-leg" key={l.outcome + l.slug}>
            <span className="fk-out">{OUTCOME_LABEL[l.outcome] ?? l.outcome}</span>
            <span className="fk-bk" title={l.alts?.length ? `Та же цена у: ${l.alts.map((a) => names[a.slug] ?? a.slug).join(", ")}` : names[l.slug] ?? l.slug}>
              {names[l.slug] ?? l.slug}
              {l.isExchange && <em className="fk-tag">биржа</em>}
              {!!l.alts?.length && <em className="fk-alts">+{l.alts.length}</em>}
            </span>
            <b className="fk-price">{l.price.toFixed(2)}</b>
            <span className="fk-net" title={net !== l.price ? "Чистый кэф после комиссии биржи" : undefined}>
              {net !== l.price ? net.toFixed(2) : ""}
            </span>
            <span
              className={`fk-over${l.overPct != null && l.overPct >= 15 ? " hi" : l.overPct != null && l.overPct >= 7 ? " mid" : ""}`}
              title="Насколько кэф выше среднего у остальных контор"
            >
              {settings.display.showOverPct && l.overPct != null ? `${l.overPct > 0 ? "+" : ""}${l.overPct.toFixed(1)}%` : ""}
            </span>
            <span className={`fk-pa${pAge > (f.kind === "live" ? 30 : 900) ? " old" : ""}`} title="Сколько назад цена подтверждена опросом конторы">
              {settings.display.showPriceAge ? fmtAge(pAge) : ""}
            </span>
            {(() => {
              const li = linkInfo(l.slug, l, f.sport, meta, settings);
              return (
                <a
                  className={`fk-link${li.exact ? "" : " section"}`}
                  href={li.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={li.exact ? "Открыть матч в конторе" : "Прямой ссылки на матч у этой конторы нет: откроется раздел, название команды скопируется в буфер - вставьте в поиск"}
                  onClick={() => {
                    unlockAudio();
                    if (!li.exact) {
                      const t = copyMatchName(meta);
                      setOpenNote(`${names[l.slug] ?? l.slug}: прямой ссылки на матч нет - открыт раздел конторы, название команды «${t}» скопировано, вставьте его в поиск.`);
                    }
                  }}
                >
                  <span className="msi">{li.exact ? "open_in_new" : "search"}</span>
                </a>
              );
            })()}
          </div>
        );
      })}
    </div>
  );

  const renderForkRow = (f: ForkRow, meta: MatchMeta | undefined, isMain: boolean, g: Group) => {
    const profit = forkProfit(f, settings);
    const age = ageSec(f, nowMs);
    const isNew = age <= settings.display.highlightNewSec;
    const filtersHit = view.matchedIds.get(f.id) ?? [];
    return (
      <div
        className={`fk-row${isMain ? " fk-r-main" : " fk-r-sub"}${selected === f.id ? " fk-sel" : ""}${isNew ? " fk-new" : ""}`}
        key={f.id}
        onClick={() => {
          unlockAudio();
          setSelected(f.id);
        }}
      >
        <div className={`fk-profit${profit >= 3 ? " big" : profit >= 1 ? " good" : profit >= 0 ? " ok" : " neg"}`}>
          {profit >= 0 ? "+" : ""}
          {profit.toFixed(2)}%
          {settings.display.showMaxProfit && <small>макс {f.maxProfitPct.toFixed(2)}%</small>}
        </div>
        {settings.display.showRoi && <div className="fk-roi" title="Доходность в процентах годовых с учётом времени до расчёта ставок">{(() => { const r = roiOf(f, meta, settings, nowMs); return r > 99999 ? ">99999" : r.toFixed(0); })()}%</div>}
        {settings.display.showAge && <div className="fk-age" title={`Найдена ${new Date(f.firstSeenAt).toLocaleTimeString("ru-RU")}`}>{fmtAge(age)}</div>}
        {isMain ? (
          <div
            className={`fk-match${settings.display.showAllQuotes ? " fk-match-click" : ""}`}
            title={settings.display.showAllQuotes ? "Нажмите, чтобы увидеть кэфы всех контор на этот матч" : undefined}
            onClick={(e) => {
              if (!settings.display.showAllQuotes) return;
              e.stopPropagation();
              unlockAudio();
              setQuotesOpen((q) => {
                const n = new Set(q);
                if (n.has(g.key)) n.delete(g.key);
                else n.add(g.key);
                return n;
              });
            }}
          >
            <div className="fk-teams">
              <span className="msi fk-sport" title={SPORT_LABELS[f.sport]}>
                {SPORT_ICONS[f.sport] ?? "sports"}
              </span>
              {meta ? `${meta.home} — ${meta.away}` : f.matchId}
              {f.kind === "live" && <em className="fk-live">LIVE</em>}
              {settings.display.showAllQuotes && <span className="msi fk-chev">{quotesOpen.has(g.key) ? "expand_less" : "expand_more"}</span>}
            </div>
            <div className="fk-sub">
              {f.kind === "live" ? (
                <>
                  {meta?.scoreHome ?? "–"}:{meta?.scoreAway ?? "–"}
                  {meta?.minute != null ? ` · ${meta.minute}'` : ""}
                </>
              ) : meta ? (
                fmtKickoff(meta.kickoffAt, nowMs)
              ) : (
                ""
              )}
              {meta?.league ? ` · ${meta.league}` : ""}
              {meta?.women ? " · жен." : ""}
              {meta?.youth ? " · молод." : ""}
            </div>
            {settings.display.showFilterTags && filtersHit.length > 0 && settings.filters.length > 1 && (
              <div className="fk-ftags">
                {filtersHit.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="fk-match fk-match-sub">другая связка контор</div>
        )}
        <div className="fk-market">{f.market === "MATCH_WINNER_2WAY" ? "Победитель" : "Исход 1X2"}</div>
        {renderLegs(f, meta)}
        <div className="fk-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="fk-icon-btn" title="Калькулятор и ставка" onClick={() => setSelected(f.id)}>
            <span className="msi">calculate</span>
          </button>
          <button
            type="button"
            className="fk-icon-btn"
            title="Открыть все конторы (разрешите всплывающие окна для example.com)"
            onClick={() => {
              unlockAudio();
              setOpenNote(openLegs(f.legs, f.sport, meta, settings, names) || null);
            }}
          >
            <span className="msi">open_in_new</span>
          </button>
          <div className="fk-menu-wrap">
            <button type="button" className="fk-icon-btn" title="Скрыть" onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>
              <span className="msi">visibility_off</span>
            </button>
            {menuFor === f.id && (
              <div className="fk-menu">
                <button type="button" onClick={() => hide("fork", f.id, `${meta?.home ?? ""} — ${meta?.away ?? ""}: ${f.legs.map((l) => names[l.slug] ?? l.slug).join(" + ")}`)}>
                  Скрыть эту вилку
                </button>
                <button type="button" onClick={() => hide("match", f.matchId, `${meta?.home ?? ""} — ${meta?.away ?? ""}`)}>
                  Скрыть все вилки матча
                </button>
                <button type="button" onClick={() => hide("pair", pairKey(f.bookmakers), f.bookmakers.map((s) => names[s] ?? s).join(" + "))}>
                  Скрыть связку {f.bookmakers.map((s) => names[s] ?? s).join(" + ")}
                </button>
              </div>
            )}
          </div>
          {isMain && g.forks.length > 1 && (
            <button
              type="button"
              className="fk-more"
              onClick={() =>
                setExpanded((s) => {
                  const n = new Set(s);
                  if (n.has(g.key)) n.delete(g.key);
                  else n.add(g.key);
                  return n;
                })
              }
            >
              {expanded.has(g.key) ? "свернуть" : `ещё ${g.forks.length - 1}`}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderAllQuotes = (g: Group) => {
    const q = g.meta?.allQuotes;
    if (!q) return null;
    const best = g.forks[0];
    return (
      <div className="fk-quotes">
        {Object.entries(q).map(([o, list]) => (
          <div className="fk-quotes-row" key={o}>
            <span className="fk-out">{OUTCOME_LABEL[o] ?? o}</span>
            {list.slice(0, 12).map((x) => {
              const inFork = best.legs.some((l) => l.outcome === o && l.slug === x.slug);
              return (
                <span className={`fk-q${inFork ? " in" : ""}`} key={x.slug} title={`подтверждено ${fmtAge((nowMs - Date.parse(x.confirmedAt)) / 1000)} назад`}>
                  {names[x.slug] ?? x.slug} <b>{x.price.toFixed(2)}</b>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const scannerWarn = (() => {
    const a = scannerAge("prematch");
    if (tab !== "live" && a != null && a > 120) return `Прематч-сканер давно не обновлялся (${fmtAge(a)}).`;
    return null;
  })();

  return (
    <div className="fk-app" onClick={() => menuFor && setMenuFor(null)}>
      <div className="fk-topbar">
        <div className="fk-tabs">
          {(
            [
              ["prematch", "Прематч", counts.prematch],
              ["live", "Live", counts.live],
              ["all", "Все", counts.prematch + counts.live],
              ["journal", "Журнал ставок", null],
              ["hidden", "Скрытое", hidden.length],
              ["settings", "Настройки", null],
            ] as [Tab, string, number | null][]
          ).map(([id, label, n]) => (
            <button type="button" key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
              {n != null && n > 0 && <span className="fk-badge">{n}</span>}
            </button>
          ))}
        </div>
        <div className="fk-status">
          {saveState === "saving" && <span className="fk-muted">сохраняю настройки…</span>}
          {saveState === "saved" && <span className="fk-muted">настройки сохранены</span>}
          {saveState === "error" && <span className="fk-err">настройки не сохранились</span>}
          <button type="button" className={`fk-btn${paused ? " fk-btn-primary" : ""}`} onClick={() => setPaused((p) => !p)} title="Пауза обновления списка (удобно, когда ставите вилку)">
            <span className="msi">{paused ? "play_arrow" : "pause"}</span>
            {paused ? "Продолжить" : "Пауза"}
          </button>
          <button type="button" className="fk-btn" onClick={() => updateSettings({ ...settings, sound: { ...settings.sound, enabled: !settings.sound.enabled } })} title="Звук новых вилок">
            <span className="msi">{settings.sound.enabled ? "volume_up" : "volume_off"}</span>
          </button>
        </div>
      </div>

      {loadError && <div className="fk-warn">{loadError}</div>}
      {scannerWarn && <div className="fk-warn">{scannerWarn}</div>}
      {openNote && (
        <div className="fk-warn fk-note" onClick={() => setOpenNote(null)} title="Нажмите, чтобы скрыть">
          {openNote}
        </div>
      )}

      {(tab === "prematch" || tab === "live" || tab === "all") && (
        <div className={`fk-main${calcFork ? " with-calc" : ""}`}>
          <div className={`fk-list${settings.display.density === "compact" ? " compact" : ""}`}>
            <div className="fk-list-head">
              {COLUMN_SORT.filter((c) => (c.key !== "roi" || settings.display.showRoi) && (c.key !== "age" || settings.display.showAge)).map((c) => (
                <button type="button" key={c.key} className={settings.sort[0]?.key === c.key ? "on" : ""} onClick={() => toggleSort(c.key)} title="Сортировать">
                  {c.label}
                  {settings.sort[0]?.key === c.key && <span className="msi">{settings.sort[0].dir === "desc" ? "arrow_downward" : "arrow_upward"}</span>}
                </button>
              ))}
              <span className="fk-list-info">
                {data ? `${view.total} вилок · ${view.groups.length} матчей` : "загрузка…"}
                {tab !== "prematch" && scannerAge("live") == null && " · Live-вилки появятся, когда идут отслеживаемые матчи"}
              </span>
            </div>
            {data && view.groups.length === 0 && (
              <div className="fk-empty">
                Сейчас нет вилок под ваши фильтры. Можно снизить минимальный доход или расширить фильтр в настройках.
              </div>
            )}
            {view.groups.map((g) => (
              <div className="fk-group" key={g.key}>
                {renderForkRow(g.forks[0], g.meta, true, g)}
                {expanded.has(g.key) && g.forks.slice(1).map((f) => renderForkRow(f, g.meta, false, g))}
                {settings.display.showAllQuotes && quotesOpen.has(g.key) && renderAllQuotes(g)}
              </div>
            ))}
          </div>
          {calcFork && (
            <div className="fk-calc-wrap">
              {calcGone && <div className="fk-warn">Вилка пропала из сканера - цены могли уйти. Сверьте кэфы в купонах.</div>}
              <ForkCalculator
                fork={calcFork}
                meta={data?.matches[`${calcFork.kind}:${calcFork.matchId}`]}
                settings={settings}
                rates={rates}
                names={names}
                onClose={() => setSelected(null)}
                onSaved={() => void loadBets()}
              />
            </div>
          )}
        </div>
      )}

      {tab === "settings" && <ForkSettingsPanel settings={settings} onChange={updateSettings} names={names} rates={rates} ratesDate={ratesDate} />}

      {tab === "hidden" && (
        <div className="fk-card fk-hidden">
          <div className="fk-sec-head">
            <h3>Скрытое</h3>
            <p>Скрытые вилки, матчи и связки контор видны только вам. Скрытая вилка вернётся, если вы её восстановите.</p>
          </div>
          {hidden.length === 0 && <div className="fk-muted">Ничего не скрыто.</div>}
          {(["fork", "match", "pair"] as const).map((k) => {
            const list = hidden.filter((h) => h.kind === k);
            if (!list.length) return null;
            return (
              <div key={k} className="fk-hidden-block">
                <h4>{k === "fork" ? "Вилки" : k === "match" ? "Матчи" : "Связки контор"}</h4>
                {list.map((h) => (
                  <div className="fk-hidden-row" key={h.id}>
                    <span>{h.label || h.key}</span>
                    <span className="fk-muted">{new Date(h.createdAt).toLocaleString("ru-RU")}</span>
                    <button type="button" className="fk-btn" onClick={() => unhide(h.id)}>
                      <span className="msi">visibility</span>Вернуть
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
          {hidden.length > 0 && (
            <button type="button" className="fk-btn fk-btn-danger" onClick={() => confirm("Вернуть всё скрытое?") && unhide()}>
              Вернуть всё
            </button>
          )}
        </div>
      )}

      {tab === "journal" && (
        <div className="fk-journal">
          {betStats && (
            <div className="fk-stats">
              <div>
                <span>Ставок</span>
                <b>{betStats.total}</b>
              </div>
              <div>
                <span>Открытых</span>
                <b>{betStats.open}</b>
              </div>
              <div>
                <span>Оборот</span>
                <b>{fmtMoney(betStats.turnoverRub)}</b>
              </div>
              <div className={betStats.resultRub >= 0 ? "pos" : "neg"}>
                <span>Итог по рассчитанным</span>
                <b>
                  {betStats.resultRub >= 0 ? "+" : ""}
                  {fmtMoney(betStats.resultRub)}
                </b>
              </div>
              <div>
                <span>Ожидается по открытым</span>
                <b>+{fmtMoney(betStats.expectedOpenRub)}</b>
              </div>
            </div>
          )}
          {bets.length === 0 && <div className="fk-muted">Журнал пуст. Записать ставку можно из калькулятора вилки.</div>}
          {bets.map((b) => (
            <div className={`fk-bet ${b.status}`} key={b.id}>
              <div className="fk-bet-head">
                <b>{b.title}</b>
                <span className="fk-muted">
                  {b.league} · {b.kind === "live" ? "Live" : "прематч"} · записана {new Date(b.createdAt).toLocaleString("ru-RU")}
                </span>
              </div>
              <div className="fk-bet-legs">
                {b.legs.map((l, i) => (
                  <span key={i} className={b.winOutcome === l.outcome ? "win" : ""}>
                    {OUTCOME_LABEL[l.outcome] ?? l.outcome} · {names[l.slug] ?? l.slug} · {l.price.toFixed(2)} · {fmtMoney(l.stake, l.currency)}
                  </span>
                ))}
              </div>
              <div className="fk-bet-foot">
                <span>Поставлено {fmtMoney(b.totalStakeRub)}</span>
                <span>Ожидалось +{fmtMoney(b.expectedProfit)}</span>
                {b.status === "settled" ? (
                  <span className={(b.resultRub ?? 0) >= 0 ? "fk-pos" : "fk-neg"}>
                    Итог {(b.resultRub ?? 0) >= 0 ? "+" : ""}
                    {fmtMoney(b.resultRub ?? 0)} ({b.winOutcome === "void" ? "возврат" : `сыграл ${OUTCOME_LABEL[b.winOutcome ?? ""] ?? b.winOutcome}`}, {b.settledBy === "auto" ? "по счёту" : "вручную"})
                  </span>
                ) : (
                  <span className="fk-bet-settle">
                    Сыграл:
                    {[...new Set(b.legs.map((l) => l.outcome))].map((o) => (
                      <button type="button" key={o} className="fk-chip" onClick={() => settle(b.id, { winOutcome: o })}>
                        {OUTCOME_LABEL[o] ?? o}
                      </button>
                    ))}
                    <button type="button" className="fk-chip" onClick={() => settle(b.id, { winOutcome: "void" })}>
                      возврат
                    </button>
                  </span>
                )}
                {b.status === "settled" && (
                  <button type="button" className="fk-chip" onClick={() => settle(b.id, { reopen: true })}>
                    открыть заново
                  </button>
                )}
                <button type="button" className="fk-icon-btn" title="Удалить" onClick={() => delBet(b.id)}>
                  <span className="msi">delete</span>
                </button>
              </div>
              {b.note && <div className="fk-muted">Заметка: {b.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
