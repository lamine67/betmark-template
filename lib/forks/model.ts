// Сканер вилок (/forks): типы, настройки по умолчанию и вся расчётная логика страницы

export type ForkKind = "prematch" | "live";

export interface ForkLeg {
  outcome: string;
  slug: string;
  price: number;
  overPct: number | null;
  capturedAt: string;
  confirmedAt: string;
  bmId: string | null;
  externalId: string | null;
  sourceUrl: string | null;
  isExchange: boolean;
  // конторы с той же ценой на этот исход (клоны линии)
  alts?: { slug: string; bmId: string | null; externalId: string | null; sourceUrl: string | null; capturedAt: string; confirmedAt: string; isExchange: boolean }[];
}

export interface ForkRow {
  id: string;
  kind: ForkKind;
  matchId: string;
  sport: string;
  market: string;
  line: number | null;
  outcomes: number;
  profitPct: number;
  maxProfitPct: number;
  legs: ForkLeg[];
  bookmakers: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MatchMeta {
  home: string;
  away: string;
  league: string;
  kickoffAt: string;
  top: boolean;
  women: boolean;
  youth: boolean;
  second: boolean;
  scoreHome?: number | null;
  scoreAway?: number | null;
  minute?: number | null;
  timerSeconds?: number | null;
  polledAt?: string | null;
  trackingId?: string;
  allQuotes?: Record<string, { slug: string; price: number; capturedAt: string; confirmedAt: string }[]>;
}

export interface ForksResponse {
  serverTime: string;
  scanner: Record<string, string | null>;
  bookmakers: Record<string, string>;
  matches: Record<string, MatchMeta>;
  forks: ForkRow[];
}

export type SortKey =
  | "profit"
  | "roi"
  | "start"
  | "liveMinute"
  | "age"
  | "updated"
  | "overMax"
  | "sport"
  | "league"
  | "bkCount"
  | "maxProfit";

export const SORT_LABELS: Record<SortKey, string> = {
  profit: "Доход вилки, %",
  roi: "ROI (годовых), %",
  start: "Время начала матча",
  liveMinute: "Минута Live-матча",
  age: "Возраст вилки (время жизни)",
  updated: "Свежесть цен (последнее подтверждение)",
  overMax: "Завышенность коэффициента",
  sport: "Вид спорта",
  league: "Лига / турнир",
  bkCount: "Число контор в матче",
  maxProfit: "Максимальный доход за жизнь вилки",
};

export interface BookmakerRule {
  sports: string[]; // пусто = все
  oddsMin: number | null;
  oddsMax: number | null;
  maxOverPct: number | null;
  onlyTop: boolean;
  disabled: boolean;
}

export interface ForkFilter {
  id: string;
  name: string;
  enabled: boolean;
  kinds: ForkKind[];
  sports: string[];
  minProfit: number;
  maxProfit: number | null;
  minRoi: number | null;
  maxRoi: number | null;
  outcomes: number[];
  startFromMin: number | null;
  startToMin: number | null;
  liveMinuteFrom: number | null;
  liveMinuteTo: number | null;
  lifetimeFromSec: number | null;
  lifetimeToSec: number | null;
  oddsMin: number | null;
  oddsMax: number | null;
  maxOverPct: number | null;
  hideErrors: boolean;
  errorOverPct: number;
  maxPriceAgePrematchSec: number | null;
  maxPriceAgeLiveSec: number | null;
  leagues: { top: boolean; other: boolean; second: boolean; women: boolean; youth: boolean };
  leagueInclude: string;
  leagueExclude: string;
  teamSearch: string;
  bookmakers: string[]; // разрешённые (пусто = все)
  requiredBookmakers: string[]; // вилка обязана содержать хотя бы одну из этих
  excludedPairs: string[]; // "a+b" (конторы по алфавиту)
  exchangeMode: "any" | "only" | "none";
  perBookmaker: Record<string, BookmakerRule>;
}

export interface ForkSettings {
  version: 1;
  filters: ForkFilter[];
  sort: { key: SortKey; dir: "asc" | "desc" }[];
  groupByMatch: boolean;
  refreshSec: number;
  display: {
    density: "compact" | "normal";
    showOverPct: boolean;
    showRoi: boolean;
    showAge: boolean;
    showAllQuotes: boolean;
    showMaxProfit: boolean;
    showPriceAge: boolean;
    showFilterTags: boolean;
    maxGroups: number;
    highlightNewSec: number;
    profitBasis: "net" | "gross";
  };
  calc: {
    defaultTotal: number;
    totalCurrency: string;
    roundMode: "nearest" | "down";
    defaultRound: number;
    roundTo: Record<string, number>;
    currency: Record<string, string>;
    maxStake: Record<string, number>;
    rateMode: "cbr" | "manual";
    manualRates: Record<string, number>;
  };
  exchange: { applyCommission: boolean; commissionPct: Record<string, number> };
  sound: { enabled: boolean; minProfit: number; volume: number; tone: "beep" | "chime" | "double" | "alarm"; kinds: ForkKind[] };
  links: Record<string, string>;
}

export const SPORT_LABELS: Record<string, string> = { football: "Футбол", hockey: "Хоккей", tennis: "Теннис" };
export const SPORT_ICONS: Record<string, string> = { football: "sports_soccer", hockey: "sports_hockey", tennis: "sports_tennis" };
export const OUTCOME_LABEL: Record<string, string> = { "1": "П1", X: "X", "2": "П2" };
export const CURRENCIES = ["RUB", "USD", "USDT", "EUR", "GBP", "KZT", "BYN", "UAH"];
export const EXCHANGE_SLUGS = new Set(["bookj"]);
const CRYPTO_SLUGS = new Set(["bookm", "booko", "bookn", "bookp", "books", "booku", "bookt", "bookr", "bookq"]);

export function newFilter(name = "Основной фильтр"): ForkFilter {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    enabled: true,
    kinds: ["prematch", "live"],
    sports: [],
    minProfit: 0,
    maxProfit: 25,
    minRoi: null,
    maxRoi: null,
    outcomes: [2, 3],
    startFromMin: null,
    startToMin: null,
    liveMinuteFrom: null,
    liveMinuteTo: null,
    lifetimeFromSec: null,
    lifetimeToSec: null,
    oddsMin: 1.01,
    oddsMax: null,
    maxOverPct: null,
    hideErrors: true,
    errorOverPct: 30,
    maxPriceAgePrematchSec: 1200,
    maxPriceAgeLiveSec: 30,
    leagues: { top: true, other: true, second: true, women: true, youth: true },
    leagueInclude: "",
    leagueExclude: "",
    teamSearch: "",
    bookmakers: [],
    requiredBookmakers: [],
    excludedPairs: [],
    exchangeMode: "any",
    perBookmaker: {},
  };
}

export function defaultSettings(): ForkSettings {
  const currency: Record<string, string> = { bookj: "GBP" };
  for (const s of CRYPTO_SLUGS) currency[s] = "USDT";
  return {
    version: 1,
    filters: [newFilter()],
    sort: [
      { key: "profit", dir: "desc" },
      { key: "age", dir: "asc" },
    ],
    groupByMatch: true,
    refreshSec: 3,
    display: {
      density: "normal",
      showOverPct: true,
      showRoi: true,
      showAge: true,
      showAllQuotes: true,
      showMaxProfit: false,
      showPriceAge: true,
      showFilterTags: true,
      maxGroups: 200,
      highlightNewSec: 20,
      profitBasis: "net",
    },
    calc: { defaultTotal: 10000, totalCurrency: "RUB", roundMode: "nearest", defaultRound: 10, roundTo: {}, currency, maxStake: {}, rateMode: "cbr", manualRates: {} },
    exchange: { applyCommission: true, commissionPct: { bookj: 2 } },
    sound: { enabled: true, minProfit: 1, volume: 0.6, tone: "chime", kinds: ["prematch", "live"] },
    links: {},
  };
}

// подмешивает недостающие поля к сохранённым настройкам (после обновлений страницы старые настройки не ломаются)
export function normalizeSettings(raw: unknown): ForkSettings {
  const d = defaultSettings();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<ForkSettings>;
  const filters = Array.isArray(r.filters) && r.filters.length ? r.filters.map((f) => ({ ...newFilter(), ...f, leagues: { ...newFilter().leagues, ...(f?.leagues || {}) }, perBookmaker: f?.perBookmaker || {} })) : d.filters;
  return {
    version: 1,
    filters,
    sort: Array.isArray(r.sort) && r.sort.length ? r.sort.filter((s) => s && s.key in SORT_LABELS) : d.sort,
    groupByMatch: typeof r.groupByMatch === "boolean" ? r.groupByMatch : d.groupByMatch,
    refreshSec: typeof r.refreshSec === "number" ? Math.min(60, Math.max(2, r.refreshSec)) : d.refreshSec,
    display: { ...d.display, ...(r.display || {}) },
    calc: { ...d.calc, ...(r.calc || {}), roundTo: { ...(r.calc?.roundTo || {}) }, currency: { ...d.calc.currency, ...(r.calc?.currency || {}) }, maxStake: { ...(r.calc?.maxStake || {}) }, manualRates: { ...(r.calc?.manualRates || {}) } },
    exchange: { ...d.exchange, ...(r.exchange || {}), commissionPct: { ...d.exchange.commissionPct, ...(r.exchange?.commissionPct || {}) } },
    sound: { ...d.sound, ...(r.sound || {}) },
    links: { ...(r.links || {}) },
  };
}

// цены и доход
export function commissionOf(slug: string, s: ForkSettings): number {
  if (!s.exchange.applyCommission) return 0;
  return EXCHANGE_SLUGS.has(slug) ? Math.max(0, Math.min(20, s.exchange.commissionPct[slug] ?? 0)) / 100 : 0;
}
// чистый кэф биржи после комиссии с выигрыша: 1 + (k - 1) * (1 - c)
export function netPrice(slug: string, price: number, s: ForkSettings): number {
  const c = commissionOf(slug, s);
  return c ? 1 + (price - 1) * (1 - c) : price;
}
export function profitOf(prices: number[]): number {
  const inv = prices.reduce((a, p) => a + 1 / p, 0);
  return (1 / inv - 1) * 100;
}
export function forkProfit(f: ForkRow, s: ForkSettings, basis: "net" | "gross" = s.display.profitBasis): number {
  return basis === "gross" ? f.profitPct : profitOf(f.legs.map((l) => netPrice(l.slug, l.price, s)));
}

const SPORT_DURATION_H: Record<string, number> = { football: 2, hockey: 2.5, tennis: 2 };
export function hoursToSettle(f: ForkRow, m: MatchMeta | undefined, nowMs: number): number {
  if (!m) return 24;
  if (f.kind === "live") {
    const min = m.minute ?? 0;
    if (f.sport === "football") return Math.max(0.1, (95 - min) / 60);
    if (f.sport === "hockey") return Math.max(0.1, (70 - min) / 60 + 0.3);
    return 1;
  }
  return Math.max(0.1, (Date.parse(m.kickoffAt) - nowMs) / 3600_000 + (SPORT_DURATION_H[f.sport] ?? 2));
}
// ROI в процентах годовых: доход вилки, растянутый на год с учётом того
export function roiOf(f: ForkRow, m: MatchMeta | undefined, s: ForkSettings, nowMs: number): number {
  return (forkProfit(f, s) * 8760) / hoursToSettle(f, m, nowMs);
}
export function ageSec(f: ForkRow, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(f.firstSeenAt)) / 1000);
}
export function priceAgeSec(f: ForkRow, nowMs: number): number {
  return Math.max(...f.legs.map((l) => (nowMs - Date.parse(l.confirmedAt)) / 1000));
}
export function maxOver(f: ForkRow): number {
  return Math.max(...f.legs.map((l) => l.overPct ?? 0));
}
export const pairKey = (slugs: string[]) => [...slugs].sort().join("+");

// фильтры
export interface FilterCtx {
  nowMs: number;
  meta: MatchMeta | undefined;
  settings: ForkSettings;
}

function inRange(v: number, a: number | null, b: number | null) {
  if (a != null && v < a) return false;
  if (b != null && v > b) return false;
  return true;
}
const words = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

// Для каждой ноги выбираем контору, подходящую фильтру: основную или клона с той же ценой (alts). prefer
export function resolveLegs(f: ForkRow, allowed: (slug: string) => boolean, prefer?: (slug: string) => boolean): ForkLeg[] | null {
  const used = new Set<string>();
  const out: ForkLeg[] = [];
  for (const l of f.legs) {
    const cands: ForkLeg[] = [
      { ...l, alts: [] },
      ...(l.alts ?? []).map((a) => ({ ...l, slug: a.slug, bmId: a.bmId, externalId: a.externalId, sourceUrl: a.sourceUrl, capturedAt: a.capturedAt, confirmedAt: a.confirmedAt, isExchange: a.isExchange, alts: [] })),
    ];
    const ok = cands.filter((c) => allowed(c.slug) && !used.has(c.slug));
    if (prefer) ok.sort((a, b) => Number(prefer(b.slug)) - Number(prefer(a.slug)));
    const pick = ok[0];
    if (!pick) return null;
    used.add(pick.slug);
    const others = cands.filter((c) => c.slug !== pick.slug && allowed(c.slug));
    out.push({
      ...pick,
      alts: others.map((c) => ({ slug: c.slug, bmId: c.bmId, externalId: c.externalId, sourceUrl: c.sourceUrl, capturedAt: c.capturedAt, confirmedAt: c.confirmedAt, isExchange: c.isExchange })),
    });
  }
  return out;
}

// Подходит ли вилка под фильтр
export function matchesFilter(f0: ForkRow, flt: ForkFilter, ctx: FilterCtx): ForkLeg[] | null {
  const { meta: m, settings: s, nowMs } = ctx;
  if (!flt.enabled) return null;
  if (!flt.kinds.includes(f0.kind)) return null;
  if (flt.sports.length && !flt.sports.includes(f0.sport)) return null;
  if (flt.outcomes.length && !flt.outcomes.includes(f0.outcomes)) return null;
  const allowed = (slug: string) => {
    if (flt.bookmakers.length && !flt.bookmakers.includes(slug)) return false;
    if (flt.exchangeMode === "none" && EXCHANGE_SLUGS.has(slug)) return false;
    const r = flt.perBookmaker[slug];
    if (r) {
      if (r.disabled) return false;
      if (r.sports.length && !r.sports.includes(f0.sport)) return false;
      if (r.onlyTop && !(m?.top ?? false)) return false;
    }
    return true;
  };
  const legs = resolveLegs(f0, allowed, flt.requiredBookmakers.length ? (sl) => flt.requiredBookmakers.includes(sl) : undefined);
  if (!legs) return null;
  const f: ForkRow = { ...f0, legs, bookmakers: legs.map((l) => l.slug) };
  const profit = forkProfit(f, s);
  if (profit < flt.minProfit) return null;
  if (flt.maxProfit != null && profit > flt.maxProfit) return null;
  if (flt.minRoi != null || flt.maxRoi != null) {
    if (!inRange(roiOf(f, m, s, nowMs), flt.minRoi, flt.maxRoi)) return null;
  }
  return matchesRest(f, flt, ctx) ? legs : null;
}

function matchesRest(f: ForkRow, flt: ForkFilter, ctx: FilterCtx): boolean {
  const { meta: m, nowMs } = ctx;
  if (m) {
    if (f.kind === "prematch" && (flt.startFromMin != null || flt.startToMin != null)) {
      const minTo = (Date.parse(m.kickoffAt) - nowMs) / 60000;
      if (!inRange(minTo, flt.startFromMin, flt.startToMin)) return false;
    }
    if (f.kind === "live" && (flt.liveMinuteFrom != null || flt.liveMinuteTo != null)) {
      if (m.minute == null || !inRange(m.minute, flt.liveMinuteFrom, flt.liveMinuteTo)) return false;
    }
    const cat = m.top ? "top" : m.second ? "second" : "other";
    if (!flt.leagues[cat as "top" | "second" | "other"]) return false;
    if (m.women && !flt.leagues.women) return false;
    if (m.youth && !flt.leagues.youth) return false;
    const leagueText = m.league.toLowerCase();
    const inc = words(flt.leagueInclude);
    if (inc.length && !inc.some((w) => leagueText.includes(w))) return false;
    const exc = words(flt.leagueExclude);
    if (exc.length && exc.some((w) => leagueText.includes(w))) return false;
    const team = words(flt.teamSearch);
    if (team.length) {
      const t = `${m.home} ${m.away}`.toLowerCase();
      if (!team.some((w) => t.includes(w))) return false;
    }
  }
  if (!inRange(ageSec(f, nowMs), flt.lifetimeFromSec, flt.lifetimeToSec)) return false;
  const maxAge = f.kind === "live" ? flt.maxPriceAgeLiveSec : flt.maxPriceAgePrematchSec;
  if (maxAge != null && priceAgeSec(f, nowMs) > maxAge) return false;
  if (flt.requiredBookmakers.length && !f.legs.some((l) => flt.requiredBookmakers.includes(l.slug))) return false;
  if (flt.excludedPairs.length) {
    for (const pair of flt.excludedPairs) {
      const ps = pair.split("+");
      if (ps.length >= 2 && ps.every((p) => f.bookmakers.includes(p))) return false;
    }
  }
  const hasEx = f.legs.some((l) => l.isExchange);
  if (flt.exchangeMode === "only" && !hasEx) return false;
  if (flt.exchangeMode === "none" && hasEx) return false;
  for (const l of f.legs) {
    if (!inRange(l.price, flt.oddsMin, flt.oddsMax)) return false;
    if (flt.maxOverPct != null && (l.overPct ?? 0) > flt.maxOverPct) return false;
    if (flt.hideErrors && (l.overPct ?? 0) >= flt.errorOverPct) return false;
    const r = flt.perBookmaker[l.slug];
    if (r) {
      if (!inRange(l.price, r.oddsMin, r.oddsMax)) return false;
      if (r.maxOverPct != null && (l.overPct ?? 0) > r.maxOverPct) return false;
    }
  }
  return true;
}

// сортировка
export function sortValue(key: SortKey, f: ForkRow, m: MatchMeta | undefined, s: ForkSettings, nowMs: number, bkCount: number): number | string {
  switch (key) {
    case "profit":
      return forkProfit(f, s);
    case "roi":
      return roiOf(f, m, s, nowMs);
    case "start":
      return m ? Date.parse(m.kickoffAt) : 0;
    case "liveMinute":
      return m?.minute ?? -1;
    case "age":
      return ageSec(f, nowMs);
    case "updated":
      return -priceAgeSec(f, nowMs);
    case "overMax":
      return maxOver(f);
    case "sport":
      return SPORT_LABELS[f.sport] ?? f.sport;
    case "league":
      return m?.league ?? "";
    case "bkCount":
      return bkCount;
    case "maxProfit":
      return f.maxProfitPct;
  }
}

export function compareBy(sort: ForkSettings["sort"], getVal: (key: SortKey, x: ForkRow) => number | string) {
  return (a: ForkRow, b: ForkRow) => {
    for (const { key, dir } of sort) {
      const va = getVal(key, a);
      const vb = getVal(key, b);
      const c = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb), "ru") : (va as number) - (vb as number);
      if (c !== 0 && !Number.isNaN(c)) return dir === "asc" ? c : -c;
    }
    return 0;
  };
}

// калькулятор
export interface CalcLegInput {
  slug: string;
  outcome: string;
  price: number; // кэф "как есть" (можно поправить вручную)
}
export interface CalcLegResult {
  slug: string;
  outcome: string;
  price: number;
  net: number;
  currency: string;
  rate: number; // руб. за 1 единицу валюты
  stake: number; // в валюте конторы, округлено
  stakeRub: number;
  payoutRub: number; // если сыграет этот исход
  capped: boolean;
}
export interface CalcResult {
  legs: CalcLegResult[];
  totalRub: number;
  minProfitRub: number;
  maxProfitRub: number;
  minProfitPct: number;
  theoreticalPct: number;
  warning: string | null;
}

export function rateFor(cur: string, rates: Record<string, number>, s: ForkSettings): number {
  if (cur === "RUB") return 1;
  if (s.calc.rateMode === "manual" && s.calc.manualRates[cur] > 0) return s.calc.manualRates[cur];
  return rates[cur] > 0 ? rates[cur] : s.calc.manualRates[cur] > 0 ? s.calc.manualRates[cur] : NaN;
}

function roundStake(v: number, step: number, mode: "nearest" | "down") {
  if (!(step > 0)) return Math.round(v * 100) / 100;
  const q = v / step;
  return (mode === "down" ? Math.floor(q + 1e-9) : Math.round(q)) * step;
}

// mode "total": totalRub - общая сумма в рублях
export function calculate(
  legsIn: CalcLegInput[],
  s: ForkSettings,
  rates: Record<string, number>,
  mode: "total" | "fixed",
  totalRub: number,
  fixedIndex: number,
  fixedAmount: number
): CalcResult {
  const legs = legsIn.map((l) => {
    const currency = s.calc.currency[l.slug] || "RUB";
    return { ...l, net: netPrice(l.slug, l.price, s), currency, rate: rateFor(currency, rates, s) };
  });
  let warning: string | null = null;
  if (legs.some((l) => !(l.rate > 0))) warning = "Нет курса для одной из валют - задайте курс вручную в настройках калькулятора.";
  const invSum = legs.reduce((a, l) => a + 1 / l.net, 0);
  // равная выплата: ставка_i (в рублях) = K / net_i
  let K: number;
  if (mode === "fixed" && legs[fixedIndex]) {
    const fl = legs[fixedIndex];
    K = fixedAmount * (fl.rate || 1) * fl.net;
  } else K = totalRub / invSum;
  let rawRub = legs.map((l) => K / l.net);
  // лимиты максимальной ставки по конторам: если превышен - уменьшаем всю вилку пропорционально
  let scale = 1;
  legs.forEach((l, i) => {
    const max = s.calc.maxStake[l.slug];
    if (max > 0) {
      const stakeCur = rawRub[i] / (l.rate || 1);
      if (stakeCur > max) scale = Math.min(scale, max / stakeCur);
    }
  });
  if (scale < 1) {
    rawRub = rawRub.map((v) => v * scale);
    warning = (warning ? warning + " " : "") + "Ставка уменьшена до лимита конторы.";
  }
  const res: CalcLegResult[] = legs.map((l, i) => {
    const step = s.calc.roundTo[l.slug] ?? (l.currency === "RUB" ? s.calc.defaultRound : 0.01);
    const isFixed = mode === "fixed" && i === fixedIndex && scale === 1;
    const stake = isFixed ? fixedAmount : roundStake(rawRub[i] / (l.rate || 1), step, s.calc.roundMode);
    const stakeRub = stake * (l.rate || 1);
    return { slug: l.slug, outcome: l.outcome, price: l.price, net: l.net, currency: l.currency, rate: l.rate, stake, stakeRub, payoutRub: stakeRub * l.net, capped: scale < 1 };
  });
  const totalRubOut = res.reduce((a, l) => a + l.stakeRub, 0);
  const profits = res.map((l) => l.payoutRub - totalRubOut);
  const minP = Math.min(...profits);
  return {
    legs: res,
    totalRub: totalRubOut,
    minProfitRub: minP,
    maxProfitRub: Math.max(...profits),
    minProfitPct: totalRubOut > 0 ? (minP / totalRubOut) * 100 : 0,
    theoreticalPct: (1 / invSum - 1) * 100,
    warning,
  };
}

// ссылки в конторы
const SPORT_PATH: Record<string, Record<string, string>> = {
  ru: { football: "football", hockey: "hockey", tennis: "tennis" },
  en: { football: "soccer", hockey: "hockey", tennis: "tennis" },
};
export const DEFAULT_LINKS: Record<string, string> = {
  booka: "{url|https://example.com",
  bookb: "{url|https://example.com",
  bookc: "https://example.com",
  bookd: "{url|https://example.com",
  booke: "{url|https://example.com",
  bookf: "{url|https://example.com",
  bookg: "https://example.com",
  bookh: "{url|https://example.com",
  booki: "{url|https://example.com",
  bookj: "{url|https://example.com",
  bookm: "https://example.com",
  booko: "https://example.com",
  bookn: "https://example.com",
  bookp: "https://example.com",
  books: "https://example.com",
  booku: "https://example.com",
  bookt: "https://example.com",
  bookr: "{url|https://example.com",
  bookq: "https://example.com",
};

// Шаблон ссылки: {url} - ссылка на матч из нашей базы, {url|запасной вариант} - если ссылки нет, {path}
export function buildLink(slug: string, leg: ForkLeg, sport: string, meta: MatchMeta | undefined, s: ForkSettings): string {
  const tpl = (s.links[slug] && s.links[slug].trim()) || DEFAULT_LINKS[slug] || "{url}";
  let path = "";
  try {
    if (leg.sourceUrl) {
      const u = new URL(leg.sourceUrl);
      path = u.pathname + u.search + u.hash;
    }
  } catch {
    path = "";
  }
  const vars: Record<string, string> = {
    url: leg.sourceUrl || "",
    path,
    externalId: leg.externalId || "",
    home: encodeURIComponent(meta?.home || ""),
    away: encodeURIComponent(meta?.away || ""),
    sportRu: SPORT_PATH.ru[sport] || sport,
    sportEn: SPORT_PATH.en[sport] || sport,
  };
  const out = tpl.replace(/\{url\|([^{}]*(?:\{[a-zA-Z]+\}[^{}]*)*)\}/g, (_m, fb: string) => (vars.url ? vars.url : fb.replace(/\{([a-zA-Z]+)\}/g, (_x, k: string) => vars[k] ?? "")));
  return out.replace(/\{([a-zA-Z]+)\}/g, (_x, k: string) => vars[k] ?? "");
}

// Контора отдаёт ссылку именно на матч?
const SECTION_ONLY_SOURCE = new Set(["bookn", "bookq"]);
export function linkInfo(slug: string, leg: ForkLeg, sport: string, meta: MatchMeta | undefined, s: ForkSettings): { url: string; exact: boolean } {
  const url = buildLink(slug, leg, sport, meta, s);
  const custom = (s.links[slug] || "").trim();
  let exact: boolean;
  if (custom) exact = /\{externalId\}/.test(custom) ? !!leg.externalId : /\{(url|path)[|}]/.test(custom) ? !!leg.sourceUrl : false;
  else exact = !!leg.sourceUrl && !SECTION_ONLY_SOURCE.has(slug) && /\{url/.test(DEFAULT_LINKS[slug] || "{url}");
  return { url, exact };
}

export function copyMatchName(meta: MatchMeta | undefined): string {
  const t = meta?.home || "";
  try {
    if (t) navigator.clipboard?.writeText(t)?.catch(() => undefined);
  } catch {
    /* буфер обмена недоступен - не страшно */
  }
  return t;
}

// Открыть все ноги вилки
export function openLegs(legs: ForkLeg[], sport: string, meta: MatchMeta | undefined, s: ForkSettings, names: Record<string, string>): string {
  let blocked = 0;
  const section: string[] = [];
  legs.forEach((l) => {
    const li = linkInfo(l.slug, l, sport, meta, s);
    if (!li.exact) section.push(names[l.slug] ?? l.slug);
    const w = window.open(li.url, "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* чужой origin - не страшно */
      }
    } else blocked++;
  });
  const parts: string[] = [];
  if (blocked) parts.push(`Браузер заблокировал вкладок: ${blocked}. Разрешите всплывающие окна для этого сайта (значок справа в адресной строке) и нажмите ещё раз - или открывайте конторы по одной кнопками справа от кэфов.`);
  if (section.length) {
    const t = copyMatchName(meta);
    parts.push(`У ${section.join(", ")} нет прямой ссылки на матч: открыт раздел конторы, название команды «${t}» скопировано - вставьте его в поиск конторы.`);
  }
  return parts.join(" ");
}

// форматирование
export function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)} с`;
  if (sec < 3600) return `${Math.floor(sec / 60)} мин`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`;
  return `${Math.floor(sec / 86400)} д`;
}
export function fmtMoney(v: number, cur = "RUB"): string {
  const sign = cur === "RUB" ? "₽" : cur;
  const digits = cur === "RUB" ? 0 : 2;
  return `${v.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${sign}`;
}
export function fmtKickoff(iso: string, nowMs: number): string {
  const d = new Date(iso);
  const diffMin = Math.round((d.getTime() - nowMs) / 60000);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const day = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
  const today = new Date(nowMs).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });
  const rel = diffMin < 60 ? `через ${Math.max(0, diffMin)} мин` : diffMin < 24 * 60 ? `через ${Math.floor(diffMin / 60)} ч` : "";
  return `${day === today ? "сегодня" : day} ${time}${rel ? ` · ${rel}` : ""}`;
}
