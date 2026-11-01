import "./lib/parserProxyInit";
// Движок Live-трекера
import { PrismaClient } from "@prisma/client";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { fetchBookaLiveOdds } from "./lib/collectors/bookaLive";
import { fetchSnapshot } from "./lib/collectors/booka";
import { topLeagueKey, isExcludedLeague, isWomenMatch } from "./lib/topLeagues";
import { topHockeyKey, isFakeNhlMatch } from "./lib/topHockey";
import { fetchBookeLiveOdds } from "./lib/collectors/bookeLive";
import { fetchBookdLiveOdds } from "./lib/collectors/bookdLive";
import { validateLiveOdds, probDiff, BOOKG_REJECT_DIFF } from "./lib/oddsSanity";
import { fetchBookbLiveOdds } from "./lib/collectors/bookbLive";
import { fetchBookfLiveOdds } from "./lib/collectors/bookfLive";
import { fetchBookcLiveOdds } from "./lib/collectors/bookcLive";
import { bookcRemoteMode, fetchBookcLiveOddsRemote } from "./lib/collectors/bookcLiveRemote";
import { fetchBookgLiveOdds } from "./lib/collectors/bookgLive";
import { fetchBookiLiveOdds } from "./lib/collectors/bookiLive";
import { fetchBookjLiveOdds } from "./lib/collectors/bookjLive";
import { fetchBookhLiveOdds } from "./lib/collectors/bookhLive";
import { fetchBookkLiveOdds } from "./lib/collectors/bookkLive";
import { fetchAlphaLiveOdds } from "./lib/collectors/alphaLive";
import { fetchBookrLiveOdds } from "./lib/collectors/bookrLive";
import {
  LIVE_ADAPTER_SLUGS,
  CRYPTO_LIVE_ADAPTER_SLUGS,
  LIVE_ADAPTER_DISPLAY,
  parseAnchor,
  LIVE_DETAIL_LEVEL_CONFIG,
  STANDARD_CHANGE_THRESHOLD,
  AI_CHECK_INTERVAL_SEC,
  type LiveDetailLevel,
} from "./lib/liveAdapters";
import type { AutoTrackLeague } from "@prisma/client";
import { passesRegularBooksGate } from "./lib/regularBooks";
import { staleCutoff } from "./lib/freshness";

// пул Prisma по умолчанию = ядра*2+1, а в контейнере видны все ядра хоста -> до ~160 подключений
const prisma = new PrismaClient({ datasources: { db: { url: (process.env.DATABASE_URL || "") + ((process.env.DATABASE_URL || "").includes("?") ? "&" : "?") + "connection_limit=15" } } });

// Тот же ИИ-прокси, что и у финального отчёта (generate-live-report.ts, runAiFinalReview)
const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || "https://example.com";
const AI_MODEL = process.env.AI_MODEL || "gemini-flash-lite-latest";
const AI_CHECK_TIMEOUT_MS = 60_000;

// Самый мелкий интервал среди уровней детализации (MAX = 5 сек) - см
const TICK_MS = Math.min(...Object.values(LIVE_DETAIL_LEVEL_CONFIG).map((c) => c.pollIntervalSec)) * 1000;
const GRACE_BEFORE_LIVE_MS = 30 * 60 * 1000; // Book A не показал live за 30 мин после кикоффа - считаем FAILED
const TIMEOUT_MS: Record<string, number> = {
  football: 150 * 60 * 1000, // 90 осн. + доп. время + перерывы с запасом
  hockey: 200 * 60 * 1000, // 60 осн. + овертайм + буллиты + перерывы с запасом
  tennis: 360 * 60 * 1000, // до 5 сетов с долгими геймами и паузами на дождь
};
const DEFAULT_TIMEOUT_MS = 180 * 60 * 1000;

interface AdapterResult {
  price1: number | null;
  priceX: number | null;
  price2: number | null;
  scoreHome: number | null;
  scoreAway: number | null;
  // только у Book G (см. bookgLive.ts) - контора сама помечает часть live-матчей как идущие с задержкой на её стороне
  delayed?: boolean;
}

// Каждый адаптер сам решает, что для него значит "матч живой у этой конторы"
type LiveAdapter = (externalId: string, sport: string) => Promise<AdapterResult | null>;

const ADAPTERS: Record<string, LiveAdapter> = {
  booka: async (externalId) => {
    const odds = await fetchBookaLiveOdds(externalId);
    if (!odds || odds.place !== "live") return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: odds.scoreHome, scoreAway: odds.scoreAway };
  },
  booke: async (externalId, sport) => {
    if (sport !== "football" && sport !== "hockey") return null;
    return fetchBookeLiveOdds(externalId, sport);
  },
  bookd: async (externalId, sport) => {
    if (sport !== "football" && sport !== "hockey") return null;
    const odds = await fetchBookdLiveOdds(externalId, sport);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  bookb: async (externalId, sport) => {
    if (sport !== "football" && sport !== "hockey") return null;
    const odds = await fetchBookbLiveOdds(externalId, sport);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  bookf: async (externalId, sport) => {
    if (sport !== "football" && sport !== "hockey") return null;
    const odds = await fetchBookfLiveOdds(externalId, sport);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  bookc: async (externalId, sport) => {
    // при флаге .bookc-remote live-кэфы Book C присылает выделенная машина (таблица BookcLiveOdds), сервер Book C не открывает
    const odds = bookcRemoteMode() ? await fetchBookcLiveOddsRemote(externalId) : await fetchBookcLiveOdds(externalId, sport);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  bookg: async (externalId, sport) => {
    const odds = await fetchBookgLiveOdds(externalId, sport);
    if (!odds) return null;
    // цена Book G из американской (1 + 100/307 = 1.32573289902280...) при записи в базу и чтении обратно отличается в
    const r3 = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 1000);
    return { price1: r3(odds.price1), priceX: r3(odds.priceX), price2: r3(odds.price2), scoreHome: null, scoreAway: null, delayed: odds.delayed };
  },
  bookh: async (externalId) => {
    const odds = await fetchBookhLiveOdds(externalId);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  booki: async (externalId, sport) => {
    const odds = await fetchBookiLiveOdds(externalId, sport);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  bookj: async (externalId, sport) => {
    const odds = await fetchBookjLiveOdds(externalId, sport);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
  bookk: async (externalId) => {
    const odds = await fetchBookkLiveOdds(externalId);
    if (!odds) return null;
    return { price1: odds.price1, priceX: odds.priceX, price2: odds.price2, scoreHome: null, scoreAway: null };
  },
};
// Крипто-конторы LiveTracking.site = "crypto") ---- Alpha-конторы (Book M, Book O, Book P, Book S)
for (const alphaSlug of ["bookm", "booko", "bookp", "books", "booku", "bookt"]) {
  ADAPTERS[alphaSlug] = async (externalId, sport) => {
    if (sport !== "football" && sport !== "hockey") return null;
    const o = await fetchAlphaLiveOdds(alphaSlug, externalId);
    if (!o || o.price1 == null || o.price2 == null) return null;
    return { price1: o.price1, priceX: o.priceX, price2: o.price2, scoreHome: o.scoreHome, scoreAway: o.scoreAway };
  };
}
ADAPTERS.bookr = async (externalId, sport) => {
  if (sport !== "football") return null;
  const o = await fetchBookrLiveOdds(externalId);
  if (!o || o.price1 == null || o.price2 == null) return null;
  return { price1: o.price1, priceX: o.priceX, price2: o.price2, scoreHome: o.scoreHome, scoreAway: o.scoreAway };
};

// "Якорь" трекинга - источник live-статуса, счёта и минуты, а также признака конца матча
type AnchorOdds = {
  place?: string | null;
  price1: number | null;
  priceX: number | null;
  price2: number | null;
  scoreHome: number | null;
  scoreAway: number | null;
  timerSeconds?: number | null;
  timerDirection?: number | null;
  scoreDetail?: string | null; // теннис: геймы по сетам и очки гейма
};

function anchorSlugOf(row: { bookaEventId: string | null }): string {
  const a = parseAnchor(row.bookaEventId);
  return a.kind === "alpha" ? a.slug : "booka";
}

async function fetchAnchorOdds(row: { bookaEventId: string | null }): Promise<AnchorOdds | null> {
  const a = parseAnchor(row.bookaEventId);
  if (a.kind === "alpha") {
    const o = await fetchAlphaLiveOdds(a.slug, a.id);
    return o ? { place: "live", ...o } : null;
  }
  return fetchBookaLiveOdds(a.id);
}

// Событие может на несколько секунд выпасть из ленты Alpha (обновление версии)
const ANCHOR_MISS_LIMIT = 6;
const anchorMisses = new Map<string, number>();
function bumpAnchorMiss(id: string): number {
  const n = (anchorMisses.get(id) ?? 0) + 1;
  anchorMisses.set(id, n);
  return n;
}

const ADAPTER_SLUGS = Object.keys(ADAPTERS);
// LIVE_ADAPTER_SLUGS (общий с API-роутом/UI) и ключи ADAPTERS должны совпадать по составу
for (const slug of LIVE_ADAPTER_SLUGS) {
  if (!(slug in ADAPTERS)) throw new Error(`liveAdapters.ts содержит "${slug}", но для него нет ADAPTERS[...] в live-tracker-poll.ts`);
}

// найдено вживую - у Book F numeric id матча (treeId) МЕНЯЕТСЯ между прематчем и лайвом
function resolveExternalId(slug: string, dbExternalId: string | undefined, homeTeam: string, awayTeam: string): string | undefined {
  // Book K - НЕ требует существующей прематч-строки (dbExternalId), в отличие от bookf ниже
  if (slug === "bookk") return `${homeTeam}__${awayTeam}`;
  if (!dbExternalId) return undefined;
  if (slug === "bookf") return `${homeTeam}__${awayTeam}`;
  return dbExternalId;
}

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function minuteFromSeconds(timerSeconds: number | null | undefined): number | null {
  return timerSeconds != null ? Math.floor(timerSeconds / 60) : null;
}

// externalId каждой конторы для матча берём НЕ из отдельного поля на LiveTracking
async function loadExternalIds(matchIds: string[]): Promise<Map<string, Map<string, string>>> {
  const rows = await prisma.bookmakerMatch.findMany({
    where: { matchId: { in: matchIds }, bookmaker: { slug: { in: ADAPTER_SLUGS } } },
    include: { bookmaker: true },
  });
  const result = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!result.has(row.matchId)) result.set(row.matchId, new Map());
    result.get(row.matchId)!.set(row.bookmaker.slug, row.externalId);
  }
  return result;
}

async function handleScheduled() {
  const now = new Date();
  const rows = await prisma.liveTracking.findMany({
    where: { status: "SCHEDULED" },
    include: { match: true },
  });
  if (rows.length === 0) return;

  const externalIds = await loadExternalIds(rows.map((r) => r.matchId));

  // матчи стартуют ПАРАЛЛЕЛЬНО
  const results = await Promise.allSettled(rows.map(async (row) => {
    if (row.match.kickoffAt > now) return; // ещё не время

    if (!row.bookaEventId) {
      await prisma.liveTracking.update({
        where: { id: row.id },
        data: { status: "FAILED", endReason: "нет bookaEventId при старте отслеживания" },
      });
      log(`[${row.id}] FAILED - нет bookaEventId`);
      return;
    }

    const anchorSlug = anchorSlugOf(row);
    let bookaOdds;
    try {
      bookaOdds = await fetchAnchorOdds(row);
    } catch (e) {
      console.error(`[${row.id}] ошибка опроса Book A (ждём live):`, e);
      return;
    }

    const isLive = bookaOdds != null && bookaOdds.place === "live";

    if (isLive && bookaOdds) {
      const scoreHome = bookaOdds.scoreHome ?? 0;
      const scoreAway = bookaOdds.scoreAway ?? 0;
      const scoreDetail = bookaOdds.scoreDetail ?? null;
      const matchMinute = minuteFromSeconds(bookaOdds.timerSeconds);

      const events: {
        trackingId: string;
        bookmakerSlug: string;
        price1: number;
        priceX: number | null;
        price2: number;
        isGoal: boolean;
        scoreHome: number;
        scoreAway: number;
        scoreDetail?: string | null;
        matchMinute: number | null;
        capturedAt: Date;
      }[] = [];
      if (bookaOdds.price1 != null && bookaOdds.price2 != null) {
        events.push({
          trackingId: row.id,
          bookmakerSlug: anchorSlug,
          price1: bookaOdds.price1,
          priceX: bookaOdds.priceX,
          price2: bookaOdds.price2,
          isGoal: false,
          scoreHome,
          scoreAway,
          scoreDetail,
          matchMinute,
          capturedAt: now,
        });
      } else {
        log(`[${row.id}] ${anchorSlug === "booka" ? "Book A" : anchorSlug} live, но рынок 1X2 сейчас закрыт (счёт ${scoreHome}:${scoreAway}) - старт без начальной цены Book A, появится позже`);
      }

      // Остальные готовые конторы - если фид уже отдаёт цену для этого матча на тот же момент старта
      const pendingStart = new Map<string, string>(); // slug -> externalId
      for (const slug of row.bookmakerSlugs) {
        if (slug === anchorSlug || !(slug in ADAPTERS)) continue;
        const externalId = resolveExternalId(slug, externalIds.get(row.matchId)?.get(slug), row.match.homeTeam, row.match.awayTeam);
        if (externalId) pendingStart.set(slug, externalId);
      }
      const START_CAPTURE_ROUNDS = 5;
      const START_CAPTURE_ROUND_DELAY_MS = 3000;
      const startSport = await sportSlugOf(row.matchId);
      for (let attempt = 0; attempt <= START_CAPTURE_ROUNDS && pendingStart.size > 0; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, START_CAPTURE_ROUND_DELAY_MS));
        await Promise.all([...pendingStart].map(async ([slug, externalId]) => {
          try {
            const odds = await ADAPTERS[slug](externalId, startSport);
            if (odds && odds.price1 != null && odds.price2 != null) {
              events.push({
                trackingId: row.id,
                bookmakerSlug: slug,
                price1: odds.price1,
                priceX: odds.priceX,
                price2: odds.price2,
                isGoal: false,
                scoreHome,
                scoreAway,
                scoreDetail,
                matchMinute,
                capturedAt: now,
              });
              pendingStart.delete(slug);
            }
          } catch (e) {
            console.error(`[${row.id}] ошибка опроса ${slug} при старте (попытка ${attempt + 1}/${START_CAPTURE_ROUNDS + 1}):`, e);
          }
        }));
      }
      if (pendingStart.size > 0) {
        log(`[${row.id}] не удалось поймать в стартовый снимок: ${[...pendingStart.keys()].join(", ")} - появятся позже, отдельной строкой`);
      }

      await prisma.$transaction([
        prisma.liveTracking.update({
          where: { id: row.id },
          data: { status: "TRACKING", startedAt: now, lastPolledAt: now, scoreHome, scoreAway, scoreDetail, matchMinute, matchTimerSeconds: bookaOdds.timerSeconds ?? null },
        }),
        prisma.liveOddsEvent.createMany({ data: events }),
      ]);
      log(`[${row.id}] матч начался (${row.match.homeTeam} - ${row.match.awayTeam}), старт отслеживания (${events.length} контор(ы))`);
      return;
    }

    const graceBaseline = Math.max(row.match.kickoffAt.getTime(), row.createdAt.getTime());
    const waitedMs = now.getTime() - graceBaseline;
    if (waitedMs > GRACE_BEFORE_LIVE_MS) {
      await prisma.liveTracking.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          endReason: `${anchorSlug === "booka" ? "Book A" : anchorSlug} не показал live-статус в течение ${Math.round(GRACE_BEFORE_LIVE_MS / 60000)} мин`,
        },
      });
      log(`[${row.id}] FAILED - live не появился вовремя`);
    }
  }));
  for (const r of results) if (r.status === "rejected") console.error("handleScheduled: ошибка старта трекинга:", r.reason);
}

// Мелкий хелпер - sport слага матча по id (нужен адаптерам вроде Book E, у которых свой URL под каждый вид спорта)
const sportCache = new Map<string, string>();
async function sportSlugOf(matchId: string): Promise<string> {
  if (sportCache.has(matchId)) return sportCache.get(matchId)!;
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: { league: { include: { sport: true } } } });
  const slug = m?.league.sport.slug ?? "";
  sportCache.set(matchId, slug);
  return slug;
}

async function finishTracking(id: string, reason: string) {
  await prisma.liveTracking.update({
    where: { id },
    data: { status: "FINISHED", endedAt: new Date(), endReason: reason },
  });
  log(`[${id}] FINISHED - ${reason}`);

  // Отчёт генерируется отдельным процессом, чтобы падение/долгая работа генератора не блокировали цикл опроса остальных
  const child = spawn("npx", ["tsx", "generate-live-report.ts", id], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

// Максимальное |Δцены| среди исходов, где есть с чем сравнить
function maxAbsDelta(last: { price1: number; priceX: number | null; price2: number }, odds: AdapterResult): number {
  let max = 0;
  if (odds.price1 != null) max = Math.max(max, Math.abs(odds.price1 - last.price1));
  if (odds.priceX != null && last.priceX != null) max = Math.max(max, Math.abs(odds.priceX - last.priceX));
  if (odds.price2 != null) max = Math.max(max, Math.abs(odds.price2 - last.price2));
  return max;
}

interface PendingGoal {
  detectedAt: number;
  scoreHome: number;
  scoreAway: number;
  goalTeam: "home" | "away" | null;
  matchMinute: number | null;
  scoreDetail?: string | null;
}

const GOAL_ODDS_DELAY_MS = 30_000;
const pendingGoals = new Map<string, PendingGoal>();

async function commitPendingGoal(row: { id: string; bookmakerSlugs: string[] }, pending: PendingGoal, freshOdds?: Map<string, AdapterResult>) {
  const capturedAt = new Date(pending.detectedAt);
  for (const slug of row.bookmakerSlugs) {
    if (slug !== "booka" && !(slug in ADAPTERS)) continue;
    let price1: number | null;
    let priceX: number | null;
    let price2: number | null;
    const fresh = freshOdds?.get(slug);
    if (fresh?.delayed) continue;
    // цена Book G в голевой строке не должна быть догольной
    if (slug === "bookg" && fresh && fresh.price1 != null && fresh.price2 != null) {
      const anchor = freshOdds?.get("booka");
      if (anchor && anchor.price1 != null && anchor.price2 != null) {
        const d = probDiff(
          { price1: anchor.price1, priceX: anchor.priceX ?? null, price2: anchor.price2 },
          { price1: fresh.price1, priceX: fresh.priceX ?? null, price2: fresh.price2 }
        );
        if (d != null && d >= BOOKG_REJECT_DIFF) continue;
      }
    }
    if (fresh && fresh.price1 != null && fresh.price2 != null) {
      price1 = fresh.price1;
      priceX = fresh.priceX;
      price2 = fresh.price2;
    } else {
      const last = await prisma.liveOddsEvent.findFirst({ where: { trackingId: row.id, bookmakerSlug: slug }, orderBy: { capturedAt: "desc" } });
      if (!last) continue;
      price1 = last.price1;
      priceX = last.priceX;
      price2 = last.price2;
    }
    await prisma.liveOddsEvent.create({
      data: {
        trackingId: row.id,
        bookmakerSlug: slug,
        price1: price1 as number,
        priceX,
        price2: price2 as number,
        isGoal: true,
        goalTeam: pending.goalTeam,
        scoreHome: pending.scoreHome,
        scoreAway: pending.scoreAway,
        matchMinute: pending.matchMinute,
        scoreDetail: pending.scoreDetail ?? null,
        capturedAt,
      },
    });
  }
  log(
    `[${row.id}] ГОЛ (${pending.goalTeam}) ${pending.scoreHome}:${pending.scoreAway}${pending.matchMinute != null ? ` на ${pending.matchMinute}-й мин.` : ""} - кэф зафиксирован`
  );
}

async function flushPendingGoalIfAny(rowId: string, bookmakerSlugs: string[]) {
  const pending = pendingGoals.get(rowId);
  if (!pending) return;
  await commitPendingGoal({ id: rowId, bookmakerSlugs }, pending);
  pendingGoals.delete(rowId);
}

const AUTO_TRACK_CHECK_INTERVAL_MS = 30 * 1000;
const AUTO_TRACK_CANDIDATE_WINDOW_MS: Record<string, number> = {
  football: 150 * 60 * 1000,
  hockey: 200 * 60 * 1000,
  tennis: 360 * 60 * 1000,
};
let lastAutoTrackCheckAt = 0;

const AUTO_SCAN_INTERVAL_MS = 45 * 1000;
let lastAutoScanAt = 0;

let liveIntervalsCache: { at: number; map: Record<string, number>; off: Set<string> } = { at: 0, map: {}, off: new Set() };
function liveIntervalSec(slug: string): number {
  if (Date.now() - liveIntervalsCache.at > 10_000) {
    let map: Record<string, number> = {};
    let off = new Set<string>();
    try {
      const c = JSON.parse(readFileSync(__dirname + "/sync-config.json", "utf8"));
      if (c.liveIntervals && typeof c.liveIntervals === "object") map = c.liveIntervals;
      if (Array.isArray(c.cryptoDisabled)) off = new Set(c.cryptoDisabled.filter((s: unknown): s is string => typeof s === "string"));
    } catch {
      /* нет файла - шаги по умолчанию */
    }
    liveIntervalsCache = { at: Date.now(), map, off };
    for (const [k, t] of lastSlugPollAt) if (Date.now() - t > 3600_000) lastSlugPollAt.delete(k); // закончившиеся матчи
  }
  const v = liveIntervalsCache.map[slug];
  return typeof v === "number" && v > 0 ? v : 0;
}
function cryptoOff(slug: string): boolean {
  liveIntervalSec(slug); // обновит кэш настроек, если он устарел
  return liveIntervalsCache.off.has(slug);
}
const lastSlugPollAt = new Map<string, number>(); // `${trackingId}:${slug}` -> когда контору в этом матче последний раз опрашивали

function liveAutoScanEnabled(): boolean {
  try {
    const c = JSON.parse(readFileSync(__dirname + "/sync-config.json", "utf8"));
    return c.liveAutoScan !== false;
  } catch {
    return true;
  }
}

async function handleAutoScan() {
  const now = Date.now();
  if (now - lastAutoScanAt < AUTO_SCAN_INTERVAL_MS) return;
  lastAutoScanAt = now;
  if (!liveAutoScanEnabled()) return;
  const freshCutoffAt = staleCutoff();
  let snapshot: Awaited<ReturnType<typeof fetchSnapshot>> | null = null;
  for (const sportSlug of ["football", "hockey"] as const) {
    const keyFn = sportSlug === "hockey" ? topHockeyKey : topLeagueKey;
    const windowMs = AUTO_TRACK_CANDIDATE_WINDOW_MS[sportSlug] ?? 180 * 60 * 1000;
    const candidates = await prisma.match.findMany({
      where: {
        league: { sport: { slug: sportSlug } },
        kickoffAt: { gte: new Date(now - windowMs), lt: new Date(now + 2 * 60 * 1000) },
        hiddenForAll: false,
        liveTracking: { none: { site: "main" } },
      },
      include: { league: true, bookmakerMatches: { include: { bookmaker: true } } },
    });
    const relevant = candidates.filter((m) => {
      if (m.topLeagueFlagged && m.topLeagueReviewAnswer !== true) return false;
      const fresh = m.bookmakerMatches.filter((bm) => bm.updatedAt >= freshCutoffAt).map((bm) => bm.bookmaker.slug);
      if (!passesRegularBooksGate(fresh)) return false;
      if (keyFn(m.league.name) == null) return false;
      if (sportSlug === "hockey") {
        return !isFakeNhlMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name, kickoffAt: m.kickoffAt, bookmakerCount: m.bookmakerMatches.length });
      }
      return !isExcludedLeague(m.league.name) && !isWomenMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name });
    });
    for (const m of relevant) {
      const bookaBm = m.bookmakerMatches.find((bm) => bm.bookmaker.slug === "booka");
      if (!bookaBm) continue;
      if (!snapshot) {
        try {
          snapshot = await fetchSnapshot();
        } catch (e) {
          console.error("handleAutoScan: fetchSnapshot упал:", e);
          return;
        }
      }
      let odds;
      try {
        odds = await fetchBookaLiveOdds(bookaBm.externalId, snapshot);
      } catch {
        continue;
      }
      if (!odds || odds.place !== "live") continue;
      const present = new Set(m.bookmakerMatches.map((bm) => bm.bookmaker.slug));
      const slugs = [...(LIVE_ADAPTER_SLUGS as readonly string[]), ...(CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[])].filter((s) => (s === "booka" || present.has(s)) && !cryptoOff(s));
      try {
        await prisma.liveTracking.create({
          data: { matchId: m.id, bookaEventId: bookaBm.externalId, status: "SCHEDULED", bookmakerSlugs: slugs, detailLevel: "MODERATE", source: "autoscan" },
        });
        log(`автоскан: поставлен на отслеживание ${m.homeTeam} - ${m.awayTeam} (${m.league.name}), контор ${slugs.length}`);
      } catch (e: unknown) {
        if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") continue;
        console.error(`handleAutoScan: ошибка создания трекинга для ${m.id}:`, e);
      }
    }
  }
}

async function handleAutoTrack() {
  const now = Date.now();
  if (now - lastAutoTrackCheckAt < AUTO_TRACK_CHECK_INTERVAL_MS) return;
  lastAutoTrackCheckAt = now;

  const configs = await prisma.autoTrackLeague.findMany({ where: { active: true } });
  if (configs.length === 0) return;

  for (const sportSlug of ["football", "hockey"] as const) {
    const sportConfigs = configs.filter((c: AutoTrackLeague) => c.sportSlug === sportSlug);
    if (sportConfigs.length === 0) continue;

    const keyFn = sportSlug === "hockey" ? topHockeyKey : topLeagueKey;
    const windowMs = AUTO_TRACK_CANDIDATE_WINDOW_MS[sportSlug] ?? 180 * 60 * 1000;

    const candidates = await prisma.match.findMany({
      where: {
        league: { sport: { slug: sportSlug } },
        kickoffAt: { gte: new Date(now - windowMs), lt: new Date(now) },
        hiddenForAll: false,
      },
      include: { league: true, bookmakerMatches: { include: { bookmaker: true } } },
    });

    const freshCutoffAt = staleCutoff();
    const relevant = candidates.filter((m) => {
      if (m.topLeagueFlagged && m.topLeagueReviewAnswer !== true) return false; // как на доске
      if (!passesRegularBooksGate(m.bookmakerMatches.filter((bm) => bm.updatedAt >= freshCutoffAt).map((bm) => bm.bookmaker.slug))) return false; // чёрный список: <2 обычных контор
      const key = keyFn(m.league.name);
      if (key == null || !sportConfigs.some((c: AutoTrackLeague) => c.leagueKey === key)) return false;
      if (sportSlug === "hockey") {
        return !isFakeNhlMatch({
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league.name,
          kickoffAt: m.kickoffAt,
          bookmakerCount: m.bookmakerMatches.length,
        });
      }
      return !isExcludedLeague(m.league.name) && !isWomenMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name });
    });
    if (relevant.length === 0) continue;

    // Не трогаем то, что уже отслеживается
    const alreadyTracked = new Set(
      (
        await prisma.liveTracking.findMany({
          where: { matchId: { in: relevant.map((m) => m.id) }, site: "main" },
          select: { matchId: true },
        })
      ).map((t) => t.matchId)
    );
    const toCheck = relevant.filter((m) => !alreadyTracked.has(m.id));
    if (toCheck.length === 0) continue;

    const withBooka = toCheck
      .map((m) => ({ match: m, bookaBm: m.bookmakerMatches.find((bm) => bm.bookmaker.slug === "booka") }))
      .filter(
        (c): c is { match: (typeof toCheck)[number]; bookaBm: NonNullable<(typeof toCheck)[number]["bookmakerMatches"][number]> } => !!c.bookaBm
      );
    if (withBooka.length === 0) continue;

    // Один снэпшот на всю проверку этого спорта
    let snapshot;
    try {
      snapshot = await fetchSnapshot();
    } catch (e) {
      console.error("handleAutoTrack: fetchSnapshot упал:", e);
      continue;
    }

    for (const { match: m, bookaBm } of withBooka) {
      let odds;
      try {
        odds = await fetchBookaLiveOdds(bookaBm.externalId, snapshot);
      } catch {
        continue;
      }
      if (!odds || odds.place !== "live") continue;

      const cfg = sportConfigs.find((c: AutoTrackLeague) => c.leagueKey === keyFn(m.league.name));
      if (!cfg) continue;

      try {
        await prisma.liveTracking.create({
          data: {
            matchId: m.id,
            bookaEventId: bookaBm.externalId,
            status: "SCHEDULED",
            bookmakerSlugs: cfg.bookmakerSlugs,
            detailLevel: cfg.detailLevel,
            source: "autotrack",
          },
        });
        log(`автослежение: назначено отслеживание ${m.homeTeam} - ${m.awayTeam} (${cfg.leagueKey})`);
      } catch (e: unknown) {
        if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") continue; // уже поставлено параллельно/вручную - не ошибка
        console.error(`handleAutoTrack: ошибка создания трекинга для ${m.id}:`, e);
      }
    }
  }
}

async function handleTracking() {
  const now = new Date();
  const allRows = await prisma.liveTracking.findMany({
    where: { status: "TRACKING" },
    include: { match: { include: { league: { include: { sport: true } } } } },
  });
  if (allRows.length === 0) return;

  // Уровень детализации - каждый трекинг опрашивается раз в СВОЙ pollIntervalSec, а не на каждый тик поллера
  const rows = allRows.filter((row) => {
    const cfg = LIVE_DETAIL_LEVEL_CONFIG[row.detailLevel as LiveDetailLevel];
    const intervalMs = (cfg?.pollIntervalSec ?? 15) * 1000;
    if (!row.lastPolledAt) return true;
    // допуск 0.7 с тики идут с фиксированным шагом
    return now.getTime() - row.lastPolledAt.getTime() >= intervalMs - 700;
  });
  if (rows.length === 0) return;

  const externalIds = await loadExternalIds(rows.map((r) => r.matchId));

  const trackingResults = await Promise.allSettled(
    rows.map(async (row) => {
    if (!row.bookaEventId || !row.startedAt) return;

    const sportSlug = row.match.league.sport.slug;
    const timeoutMs = TIMEOUT_MS[sportSlug] ?? DEFAULT_TIMEOUT_MS;
    if (now.getTime() - row.startedAt.getTime() > timeoutMs) {
      // Флашим зависший гол ДО завершения - иначе он никогда не получит свою "официальную" кэф-строку
      await flushPendingGoalIfAny(row.id, row.bookmakerSlugs);
      await finishTracking(row.id, "таймаут - матч отслеживался дольше разумного максимума длительности");
      return;
    }

    const anchorSlug = anchorSlugOf(row);
    let bookaOdds;
    try {
      const ta = Date.now();
      bookaOdds = await fetchAnchorOdds(row);
      slowNote("якорь Book A", Date.now() - ta);
    } catch (e) {
      console.error(`[${row.id}] ошибка опроса Book A во время трекинга:`, e);
      return;
    }

    if (!bookaOdds && anchorSlug !== "booka" && bumpAnchorMiss(row.id) < ANCHOR_MISS_LIMIT) return;
    if (!bookaOdds) {
      // Событие целиком пропало из live-ленты Book A
      await flushPendingGoalIfAny(row.id, row.bookmakerSlugs);
      await finishTracking(row.id, `событие пропало из live-ленты ${anchorSlug === "booka" ? "Book A" : anchorSlug} (матч завершён)`);
      return;
    }

    // lastPolledAt обновляем СРАЗУ, а не только при успешной записи
    anchorMisses.delete(row.id);
    await prisma.liveTracking.update({ where: { id: row.id }, data: { lastPolledAt: now } });

    const detailConfig = LIVE_DETAIL_LEVEL_CONFIG[row.detailLevel as LiveDetailLevel] ?? LIVE_DETAIL_LEVEL_CONFIG.MODERATE;
    const scoreHome = bookaOdds.scoreHome ?? row.scoreHome ?? 0;
    const scoreAway = bookaOdds.scoreAway ?? row.scoreAway ?? 0;
    const scoreDetail = bookaOdds.scoreDetail ?? null;
    const matchMinute = minuteFromSeconds(bookaOdds.timerSeconds);
    const matchTimerSeconds = bookaOdds.timerSeconds ?? null;
    const onBreak = bookaOdds.timerDirection === 0 && (bookaOdds.timerSeconds ?? 0) > 0;

    const priorScoreHome = row.scoreHome ?? 0;
    const priorScoreAway = row.scoreAway ?? 0;
    const goalJustHappened = scoreHome !== priorScoreHome || scoreAway !== priorScoreAway;
    if (goalJustHappened) {
      const existingPending = pendingGoals.get(row.id);
      if (existingPending) {
        await commitPendingGoal(row, existingPending);
      }
      const goalTeam: "home" | "away" | null = scoreHome > priorScoreHome ? "home" : scoreAway > priorScoreAway ? "away" : null;
      pendingGoals.set(row.id, { detectedAt: now.getTime(), scoreHome, scoreAway, goalTeam, matchMinute, scoreDetail });
      log(
        `[${row.id}] ГОЛ обнаружен (${goalTeam}) ${scoreHome}:${scoreAway}${matchMinute != null ? ` на ${matchMinute}-й мин.` : ""} - жду ${GOAL_ODDS_DELAY_MS / 1000}с перед фиксацией кэфа`
      );
    }
    const pendingGoal = pendingGoals.get(row.id);
    const committingGoal = !!pendingGoal && now.getTime() - pendingGoal.detectedAt >= GOAL_ODDS_DELAY_MS;
    const freshOddsThisTick = new Map<string, AdapterResult>();

    const tPhase = Date.now();
    await Promise.all(
      row.bookmakerSlugs.map(async (slug) => {
      if (slug !== anchorSlug && !(slug in ADAPTERS)) return;
      if (slug !== anchorSlug && cryptoOff(slug)) return;
      if (slug !== anchorSlug) {
        const stepSec = liveIntervalSec(slug);
        const key = `${row.id}:${slug}`;
        if (stepSec > 0 && now.getTime() - (lastSlugPollAt.get(key) ?? 0) < stepSec * 1000 - 700) return; // шаг этой конторы ещё не прошёл
        lastSlugPollAt.set(key, now.getTime());
      }
      let odds: AdapterResult | null;
      if (slug === anchorSlug) {
        odds = { price1: bookaOdds.price1, priceX: bookaOdds.priceX, price2: bookaOdds.price2, scoreHome, scoreAway };
      } else {
        const externalId = resolveExternalId(slug, externalIds.get(row.matchId)?.get(slug), row.match.homeTeam, row.match.awayTeam);
        if (!externalId) return;
        const ODDS_RETRY_ATTEMPTS = 3;
        const ODDS_RETRY_DELAY_MS = 1500;
        // (опрос матча раз в 5 с): ретраи нужны, чтобы не принять секундную «мигалку» источника за пропажу цены
        const lastKnown = await prisma.liveOddsEvent.findFirst({ where: { trackingId: row.id, bookmakerSlug: slug }, orderBy: { capturedAt: "desc" }, select: { unavailable: true } });
        const maxAttempts = lastKnown?.unavailable ? 0 : ODDS_RETRY_ATTEMPTS;
        odds = null;
        const slugStartedAt = Date.now();
        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
          // повторы - только пока укладываемся в бюджет конторы на тик
          const left = ADAPTER_SLUG_BUDGET_MS - (Date.now() - slugStartedAt) - (attempt > 0 ? ODDS_RETRY_DELAY_MS : 0);
          if (attempt > 0 && left < 1500) break;
          if (attempt > 0) await new Promise((r) => setTimeout(r, ODDS_RETRY_DELAY_MS));
          try {
            const t0 = Date.now();
            const res = await callAdapterBounded(slug, externalId, sportSlug, Math.min(ADAPTER_DEADLINE_MS, left));
            slowNote(`адаптер ${slug}`, Date.now() - t0);
            if (res === ADAPTER_PENDING) {
              // контора не ответила за отведённое время - в этом тике её просто нет (без маркера «нет цены»)
              slowNote(`не успел ${slug}`, 1);
              return;
            }
            odds = res;
          } catch (e) {
            console.error(`[${row.id}] ошибка опроса ${slug} во время трекинга (попытка ${attempt + 1}/${ODDS_RETRY_ATTEMPTS + 1}):`, e);
            odds = null;
          }
          if (odds && odds.price1 != null && odds.price2 != null) break;
        }
      }

      // : цена конторы, которая сильно расходится с якорной (Book A) по вероятностям исходов
      if (sportSlug !== "tennis" && odds && slug !== anchorSlug && odds.price1 != null && odds.price2 != null && !pendingGoal && bookaOdds.price1 != null && bookaOdds.price2 != null) {
        const tv = Date.now();
        const verdict = await validateLiveOdds({
          trackingId: row.id,
          slug,
          sport: sportSlug,
          home: row.match.homeTeam,
          away: row.match.awayTeam,
          scoreHome,
          scoreAway,
          minute: matchMinute,
          anchorSlug,
          anchor: { price1: bookaOdds.price1, priceX: bookaOdds.priceX ?? null, price2: bookaOdds.price2 },
          candidate: { price1: odds.price1, priceX: odds.priceX ?? null, price2: odds.price2 },
        });
        slowNote("проверка Gemini", Date.now() - tv);
        if (!verdict.ok) {
          log(`[${row.id}] ${slug}: цены ${odds.price1}/${odds.priceX ?? "-"}/${odds.price2} отброшены как неверный рынок/старое состояние (${verdict.reason})`);
          odds = null;
        }
      }

      if (odds && odds.price1 != null && odds.price2 != null) {
        freshOddsThisTick.set(slug, odds);
        noteConfirmed(row.id, slug);
      }

      if (odds?.delayed && !row.bookgDelayed) {
        await prisma.liveTracking.update({ where: { id: row.id }, data: { bookgDelayed: true } });
      }

      const last = await prisma.liveOddsEvent.findFirst({
        where: { trackingId: row.id, bookmakerSlug: slug },
        orderBy: { capturedAt: "desc" },
      });
      if (!last && slug === anchorSlug && anchorSlug !== "booka" && odds && odds.price1 != null && odds.price2 != null) {
        await prisma.liveOddsEvent.create({
          data: { trackingId: row.id, bookmakerSlug: slug, price1: odds.price1, priceX: odds.priceX, price2: odds.price2, isGoal: false, scoreHome, scoreAway, scoreDetail, matchMinute, capturedAt: now },
        });
        return;
      }
      if (!last) return; // для booka не должно случаться; для остальных

      if (!odds) {
        if (!last.unavailable) {
          await prisma.liveOddsEvent.create({
            data: {
              trackingId: row.id,
              bookmakerSlug: slug,
              price1: last.price1,
              priceX: last.priceX,
              price2: last.price2,
              isGoal: false,
              goalTeam: null,
              scoreHome,
              scoreAway,
              scoreDetail,
              matchMinute,
              capturedAt: now,
              unavailable: true,
            },
          });
        }
        return;
      }

      const oddsUsable = odds.price1 != null && odds.price2 != null;
      const priceChanged =
        oddsUsable && (last.price1 !== odds.price1 || (last.priceX ?? null) !== (odds.priceX ?? null) || last.price2 !== odds.price2);

      const STALE_ODDS_MS = Math.max(slug === "bookg" ? 2 * 60 * 1000 : 6 * 60 * 1000, liveIntervalSec(slug) * 4000);
      const scoreChangedSinceLast = scoreHome !== (last.scoreHome ?? 0) || scoreAway !== (last.scoreAway ?? 0);
      const staleTooLong = now.getTime() - last.capturedAt.getTime() > STALE_ODDS_MS;
      const looksStuck = slug !== anchorSlug && oddsUsable && !priceChanged && !last.unavailable && !onBreak && (scoreChangedSinceLast || staleTooLong);

      if (looksStuck) {
        await prisma.liveOddsEvent.create({
          data: {
            trackingId: row.id,
            bookmakerSlug: slug,
            price1: last.price1,
            priceX: last.priceX,
            price2: last.price2,
            isGoal: false,
            goalTeam: null,
            scoreHome,
            scoreAway,
            scoreDetail,
            matchMinute,
            capturedAt: now,
            unavailable: true,
          },
        });
        return;
      }

      // Что именно пишем - зависит от уровня детализации трекинга (см. lib/liveAdapters.ts, LIVE_DETAIL_LEVEL_CONFIG)
      let shouldWrite = false;
      if (oddsUsable) {
        switch (detailConfig.writeRule) {
          case "always":
            shouldWrite = true;
            break;
          case "anyChange":
            shouldWrite = priceChanged;
            break;
          case "threshold":
            shouldWrite = priceChanged && maxAbsDelta(last, odds) >= STANDARD_CHANGE_THRESHOLD;
            break;
          case "goalOnly":
            shouldWrite = false; // экономичный - вне гола вообще не пишет
            break;
        }
      }

      // В перерыве контора снова отдаёт цены, а на ней висит метка «нет данных» (прочерк)
      const clearMarkerOnBreak = onBreak && !!last.unavailable && oddsUsable;
      if (shouldWrite || clearMarkerOnBreak) {
        await prisma.liveOddsEvent.create({
          data: {
            trackingId: row.id,
            bookmakerSlug: slug,
            price1: odds.price1 ?? last.price1,
            priceX: odds.priceX ?? last.priceX,
            price2: odds.price2 ?? last.price2,
            isGoal: false,
            goalTeam: null,
            scoreHome,
            scoreAway,
            scoreDetail,
            matchMinute,
            capturedAt: now,
          },
        });
      }
      })
    );

    slowNote("фаза: все конторы матча", Date.now() - tPhase);
    if (committingGoal && pendingGoal) {
      await commitPendingGoal(row, pendingGoal, freshOddsThisTick);
      pendingGoals.delete(row.id);
    }

    // Для конторы, у которой ЕЩЁ нет ни одной записи к моменту первого реального изменения
    await Promise.all(
      row.bookmakerSlugs.map(async (slug) => {
      if (slug === anchorSlug || !(slug in ADAPTERS)) return;
      const externalId = resolveExternalId(slug, externalIds.get(row.matchId)?.get(slug), row.match.homeTeam, row.match.awayTeam);
      if (!externalId) return;
      const existing = await prisma.liveOddsEvent.findFirst({ where: { trackingId: row.id, bookmakerSlug: slug } });
      if (existing) return;
      try {
        const t0 = Date.now();
        const res = await callAdapterBounded(slug, externalId, sportSlug);
        slowNote(`подхват ${slug}`, Date.now() - t0);
        const odds = res === ADAPTER_PENDING ? null : res;
        if (odds && odds.price1 != null && odds.price2 != null) {
          await prisma.liveOddsEvent.create({
            data: {
              trackingId: row.id,
              bookmakerSlug: slug,
              price1: odds.price1,
              priceX: odds.priceX,
              price2: odds.price2,
              isGoal: false,
              scoreHome,
              scoreAway,
              scoreDetail,
              matchMinute,
              capturedAt: now,
            },
          });
        }
      } catch (e) {
        console.error(`[${row.id}] ошибка при попытке подхватить ${slug} с опозданием:`, e);
      }
      })
    );

    if (scoreHome !== row.scoreHome || scoreAway !== row.scoreAway || scoreDetail !== row.scoreDetail || matchMinute !== row.matchMinute || matchTimerSeconds !== row.matchTimerSeconds) {
      await prisma.liveTracking.update({ where: { id: row.id }, data: { scoreHome, scoreAway, scoreDetail, matchMinute, matchTimerSeconds } });
    }
    })
  );

  for (const r of trackingResults) {
    if (r.status === "rejected") console.error("handleTracking: необработанная ошибка при обработке одного из трекингов:", r.reason);
  }
  flushConfirmed(new Set(allRows.map((r) => r.id)));
}

async function runPeriodicAiCheck() {
  const now = new Date();
  const rows = await prisma.liveTracking.findMany({
    where: { status: "TRACKING", detailLevel: "ULTRA" },
    include: { match: { include: { league: { include: { sport: true } } } } },
  });

  for (const row of rows) {
    const since = row.lastAiCheckAt ?? row.startedAt ?? row.createdAt;
    if (now.getTime() - since.getTime() < AI_CHECK_INTERVAL_SEC * 1000) continue;

    const events = await prisma.liveOddsEvent.findMany({
      where: { trackingId: row.id, capturedAt: { gt: since }, unavailable: false },
      orderBy: { capturedAt: "asc" },
    });

    // Нечего проверять в этом окне - всё равно сдвигаем lastAiCheckAt
    if (events.length === 0) {
      await prisma.liveTracking.update({ where: { id: row.id }, data: { lastAiCheckAt: now } });
      continue;
    }

    if (!AI_API_KEY) {
      console.error(`[${row.id}] ULTRA: нет AI_API_KEY, периодическая ИИ-проверка пропущена`);
      await prisma.liveTracking.update({ where: { id: row.id }, data: { lastAiCheckAt: now } });
      continue;
    }

    try {
      const payloadEvents = events.map((e) => ({
        id: e.id,
        time: e.capturedAt.toISOString(),
        bookmaker: LIVE_ADAPTER_DISPLAY[e.bookmakerSlug as keyof typeof LIVE_ADAPTER_DISPLAY] ?? e.bookmakerSlug,
        price1: e.price1,
        priceX: e.priceX,
        price2: e.price2,
        isGoal: e.isGoal,
        scoreHome: e.scoreHome,
        scoreAway: e.scoreAway,
      }));

      const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${AI_API_KEY}` },
        signal: AbortSignal.timeout(AI_CHECK_TIMEOUT_MS),
        body: JSON.stringify({
          model: AI_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          enable_thinking: false,
          messages: [
            {
              role: "system",
              content:
                "Ты проверяешь live-коэффициенты одного спортивного матча ПРЯМО ВО ВРЕМЯ трекинга (матч ещё " +
                "идёт, это не финальный отчёт) на предмет ОШИБОК СБОРА ДАННЫХ у сайта-агрегатора букмекерских " +
                "контор. На входе - только НОВЫЕ события с прошлой проверки (не вся история матча): у каждого " +
                "свой id, время (ISO UTC), контора, коэффициенты П1/X/П2 (X может быть null для видов спорта " +
                "без ничьей), был ли гол, счёт на тот момент. Твоя ЕДИНСТВЕННАЯ задача - найти АНОМАЛИИ: " +
                "значения, которые выглядят как ОШИБКА ПАРСИНГА/СБОРА (не настоящая цена букмекера), а не как " +
                "обычное движение линии. Примеры настоящих аномалий: явно нереалистичное значение (например " +
                "500.00 или 0.01 на обычный исход в командном виде спорта), значение резко выбивается на ОДНО " +
                "событие и тут же возвращается к прежнему уровню у той же конторы без гола-причины, сумма " +
                "implied-вероятностей по трём исходам совершенно абсурдна. Если одна и та же неправдоподобная " +
                "цена у ОДНОЙ конторы повторяется НЕСКОЛЬКО событий подряд - это ВСЁ РАВНО аномалия, включи " +
                "КАЖДОЕ такое событие ОТДЕЛЬНОЙ записью (по своему id). НЕ считай аномалией: обычное " +
                "расхождение цены между разными конторами, резкий скачок СРАЗУ после гола (ожидаемо и " +
                "правильно), постепенный тренд цены в одну сторону. Если сомневаешься - НЕ включай, лучше " +
                "пропустить настоящую ошибку, чем ошибочно вычеркнуть настоящую цену букмекера. Верни ТОЛЬКО " +
                'JSON вида {"anomalies": [{"id": "...", "reason": "..."}]} - id должен ТОЧНО совпадать с id ' +
                "входного события. Если аномалий нет - верни пустой массив.",
            },
            {
              role: "user",
              content: JSON.stringify({
                match: {
                  home: row.match.homeTeam,
                  away: row.match.awayTeam,
                  league: row.match.league.name,
                  sport: row.match.league.sport.slug,
                  score: `${row.scoreHome ?? 0} : ${row.scoreAway ?? 0}`,
                },
                events: payloadEvents,
              }),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("пустой content в ответе");
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.anomalies)) throw new Error("неожиданный формат ответа ИИ");

      const byId = new Map(events.map((e) => [e.id, e]));
      let flaggedCount = 0;
      for (const a of parsed.anomalies) {
        if (!byId.has(a.id)) continue;
        await prisma.liveOddsEvent.update({
          where: { id: a.id },
          data: { aiFlagged: true, aiFlagReason: typeof a.reason === "string" ? a.reason : "ИИ пометил как аномалию" },
        });
        flaggedCount++;
      }
      log(`[${row.id}] ULTRA ИИ-проверка: ${flaggedCount} аномалий из ${events.length} новых событий`);
    } catch (e) {
      // При ошибке (сеть/лимит/таймаут API) НЕ сдвигаем lastAiCheckAt
      console.error(`[${row.id}] ULTRA периодическая ИИ-проверка упала:`, (e as Error).message);
      continue;
    }

    await prisma.liveTracking.update({ where: { id: row.id }, data: { lastAiCheckAt: now } });
  }
}

let scheduledInFlight: Promise<void> | null = null;

// для сканера вилок: когда КАЖДАЯ контора по каждому матчу в последний раз реально вернула проверенную цену
const LIVE_CONFIRM_FILE = __dirname + "/.live-confirm.json";
const liveConfirmed = new Map<string, Record<string, number>>();
function noteConfirmed(trackingId: string, slug: string) {
  const m = liveConfirmed.get(trackingId) ?? {};
  m[slug] = Date.now();
  liveConfirmed.set(trackingId, m);
}
function flushConfirmed(activeIds: Set<string>) {
  for (const id of [...liveConfirmed.keys()]) if (!activeIds.has(id)) liveConfirmed.delete(id);
  try {
    writeFileSync(LIVE_CONFIRM_FILE + ".tmp", JSON.stringify({ at: Date.now(), t: Object.fromEntries(liveConfirmed) }));
    renameSync(LIVE_CONFIRM_FILE + ".tmp", LIVE_CONFIRM_FILE);
  } catch (e) {
    console.error("flushConfirmed:", e);
  }
}

// (Live-автоскан поставил 12 матчей разом)
const ADAPTER_DEADLINE_MS = 6000;
const ADAPTER_SLUG_BUDGET_MS = 7000;
const ADAPTER_LATE_TTL_MS = 8000;
const ADAPTER_PENDING = Symbol("adapter-pending");
const adapterInflight = new Map<string, Promise<AdapterResult | null>>();
const adapterLate = new Map<string, { at: number; odds: AdapterResult | null }>();

async function callAdapterBounded(slug: string, externalId: string, sport: string, deadlineMs = ADAPTER_DEADLINE_MS): Promise<AdapterResult | null | typeof ADAPTER_PENDING> {
  const key = `${slug}|${externalId}`;
  const late = adapterLate.get(key);
  if (late) {
    adapterLate.delete(key);
    if (Date.now() - late.at <= ADAPTER_LATE_TTL_MS) return late.odds;
  }
  let p = adapterInflight.get(key);
  if (!p) {
    const started = ADAPTERS[slug](externalId, sport);
    p = started.finally(() => adapterInflight.delete(key));
    adapterInflight.set(key, p);
    // ответ, пришедший после дедлайна, сохраняем для следующего тика
    p.then(
      (odds) => adapterLate.set(key, { at: Date.now(), odds }),
      () => undefined
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    p.then((odds) => ({ odds })),
    new Promise<typeof ADAPTER_PENDING>((res) => {
      timer = setTimeout(() => res(ADAPTER_PENDING), deadlineMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (r === ADAPTER_PENDING) return ADAPTER_PENDING;
  adapterLate.delete(key); // ответ получен вовремя и уже использован
  return r.odds;
}

// замер долгих шагов опроса (самый долгий вызов каждого вида за тик) - в лог только если тик длиннее 15 с
const slowSteps = new Map<string, number>();
function slowNote(key: string, ms: number) {
  if (ms > (slowSteps.get(key) ?? 0)) slowSteps.set(key, ms);
}

async function tick() {
  if (!scheduledInFlight) {
    scheduledInFlight = handleScheduled()
      .catch((e) => console.error("handleScheduled error:", e))
      .finally(() => {
        scheduledInFlight = null;
      });
  }
  try {
    const tt = Date.now();
    await handleTracking();
    const dt = Date.now() - tt;
    if (dt > 15_000) log(`медленный тик опроса: ${Math.round(dt / 1000)} с; самые долгие шаги: ${[...slowSteps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(v / 1000)}с`).join(", ")}`);
    slowSteps.clear();
  } catch (e) {
    console.error("handleTracking error:", e);
  }
  try {
    await handleAutoTrack();
  } catch (e) {
    console.error("handleAutoTrack error:", e);
  }
  try {
    await handleAutoScan();
  } catch (e) {
    console.error("handleAutoScan error:", e);
  }
  try {
    await runPeriodicAiCheck();
  } catch (e) {
    console.error("runPeriodicAiCheck error:", e);
  }
}

async function main() {
  log(`live-tracker-poll запущен, тик каждые ${TICK_MS}мс, конторы: ${ADAPTER_SLUGS.join(", ")}`);
  for (;;) {
    const startedAt = Date.now();
    await tick();
    await new Promise((r) => setTimeout(r, Math.max(200, TICK_MS - (Date.now() - startedAt))));
  }
}

main();
