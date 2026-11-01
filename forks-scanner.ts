import { readFileSync } from "fs";
// Сканер вилок раздел /forks)
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { isTopLeague, isWomenMatch } from "./lib/topLeagues";
import { topHockeyKey } from "./lib/topHockey";
import { isTopTennisTournament } from "./lib/topTennis";
import { isCryptoSlug } from "./lib/cryptoBooks";

const url = process.env.DATABASE_URL || "";
const prisma = new PrismaClient({ datasources: { db: { url: /connection_limit=/.test(url) ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=4" } } });

const PREMATCH_EVERY_MS = 15_000;
const LIVE_EVERY_MS = 3_000;
const SETTLE_EVERY_MS = 5 * 60_000;
const PREMATCH_FLOOR = -3;
const LIVE_FLOOR = -4;
const TOP_PER_OUTCOME = 5; // перебираем 5 лучших контор на исход (до 125 сочетаний), храним MAX_COMBOS_PER_MARKET лучших
const MAX_COMBOS_PER_MARKET = 12;
const KEEP_ENDED_MS = 24 * 3600_000;
const EXCHANGES = new Set(["bookj"]);
const STALE_MS = 3 * 3600_000;

type Kind = "prematch" | "live";
interface Quote {
  slug: string;
  price: number;
  capturedAt: Date; // когда цена в последний раз менялась
  confirmedAt: Date; // когда контору в последний раз опрашивали (цена подтверждена)
  bmId: string | null;
  externalId: string | null;
  sourceUrl: string | null;
}
interface MarketInput {
  kind: Kind;
  matchId: string;
  sport: string;
  market: "MATCH_WINNER_1X2" | "MATCH_WINNER_2WAY";
  outcomes: string[];
  quotes: Record<string, Quote[]>;
  meta: Record<string, unknown>;
}
interface Leg {
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
  // конторы с ТОЙ ЖЕ ценой на этот исход (клоны линии) - пользователь может поставить в любой из них
  alts?: { slug: string; bmId: string | null; externalId: string | null; sourceUrl: string | null; capturedAt: string; confirmedAt: string; isExchange: boolean }[];
}
interface ComputedFork {
  id: string;
  kind: Kind;
  matchId: string;
  sport: string;
  market: string;
  outcomes: number;
  profitPct: number;
  legs: Leg[];
  meta: Record<string, unknown>;
  bookmakers: string[];
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function leagueFlags(sport: string, league: string, home: string, away: string) {
  const text = `${league} ${home} ${away}`;
  const top = sport === "football" ? isTopLeague(league) : sport === "hockey" ? topHockeyKey(league) != null : isTopTennisTournament(league);
  const women = isWomenMatch({ homeTeam: home, awayTeam: away, league }) || /\(ж\)|жен|women|wta/i.test(text);
  const youth = /\bU-?\s?(1[5-9]|2[0-3])\b|U(1[5-9]|2[0-3])|молод|юниор|юнош|youth|junior|резерв|reserve|\bII\b|\b2\b(?= *$)/i.test(text);
  const second = !top && /втор|третья|третий|2-я|3-я|first league|second|league two|league one|segunda|serie b|serie c|2\. ?bundesliga|3\. ?liga|ligue 2|championship|division 2|division 3|дивизион 2|дивизион 3|regional|региональ|любител/i.test(league);
  return { top, women, youth, second };
}

function hashId(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 32);
}

const PRIMARY_ORDER = ["booka", "bookb", "bookc", "bookd", "booke", "bookf", "bookg", "bookh", "booki", "bookj", "bookr", "bookq", "bookn"];
const primaryRank = (slug: string) => {
  const i = PRIMARY_ORDER.indexOf(slug);
  return i >= 0 ? i : 100;
};
interface PriceGroup {
  price: number;
  main: Quote;
  alts: Quote[];
}

function computeForks(m: MarketInput, floor: number): ComputedFork[] {
  // лучшая цена каждой конторы по исходу
  const per: Quote[][] = m.outcomes.map((o) => {
    const best = new Map<string, Quote>();
    for (const q of m.quotes[o] ?? []) if (q.price > 1 && (!best.has(q.slug) || best.get(q.slug)!.price < q.price)) best.set(q.slug, q);
    return [...best.values()].sort((a, b) => b.price - a.price);
  });
  if (per.some((l) => l.length === 0)) return [];
  // конторы с одинаковой ценой на исход (типично - клоны одной линии, например Alpha)
  const groups: PriceGroup[][] = per.map((list) => {
    const byPrice = new Map<string, Quote[]>();
    for (const q of list) {
      const k = q.price.toFixed(3);
      (byPrice.get(k) ?? byPrice.set(k, []).get(k)!).push(q);
    }
    return [...byPrice.values()]
      .map((qs) => {
        const sorted = [...qs].sort((a, b) => primaryRank(a.slug) - primaryRank(b.slug) || a.slug.localeCompare(b.slug));
        return { price: sorted[0].price, main: sorted[0], alts: sorted.slice(1) };
      })
      .sort((a, b) => b.price - a.price);
  });
  // завышенность считаем против контор ДРУГИХ цен (клоны той же линии не должны "подтверждать" сами себя)
  const avgOthers = (o: number, price: number): number | null => {
    const xs = per[o].filter((q) => Math.abs(q.price - price) > 1e-9).map((q) => q.price);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const tops = groups.map((l) => l.slice(0, TOP_PER_OUTCOME));
  // все цены матча по исходам (лучшая у каждой конторы) - для сравнения кэфов прямо в строке вилки
  const allQuotes = Object.fromEntries(
    m.outcomes.map((o, i) => [o, per[i].map((q) => ({ slug: q.slug, price: q.price, capturedAt: q.capturedAt.toISOString(), confirmedAt: q.confirmedAt.toISOString() }))])
  );
  const meta = { ...m.meta, allQuotes };
  const out: ComputedFork[] = [];
  const pick = (i: number, chosen: PriceGroup[]) => {
    if (i === tops.length) {
      const slugs = new Set(chosen.map((g) => g.main.slug));
      if (slugs.size !== chosen.length) return; // одна контора на два исхода - не вилка
      const sumInv = chosen.reduce((s, g) => s + 1 / g.price, 0);
      const profit = (1 / sumInv - 1) * 100;
      if (profit < floor) return;
      const legs: Leg[] = chosen.map((g, idx) => {
        const q = g.main;
        const avg = avgOthers(idx, g.price);
        return {
          outcome: m.outcomes[idx],
          slug: q.slug,
          price: q.price,
          overPct: avg ? Math.round((q.price / avg - 1) * 1000) / 10 : null,
          capturedAt: q.capturedAt.toISOString(),
          confirmedAt: q.confirmedAt.toISOString(),
          bmId: q.bmId,
          externalId: q.externalId,
          sourceUrl: q.sourceUrl,
          isExchange: EXCHANGES.has(q.slug),
          alts: g.alts.map((a) => ({ slug: a.slug, bmId: a.bmId, externalId: a.externalId, sourceUrl: a.sourceUrl, capturedAt: a.capturedAt.toISOString(), confirmedAt: a.confirmedAt.toISOString(), isExchange: EXCHANGES.has(a.slug) })),
        };
      });
      const key = `${m.kind}|${m.matchId}|${m.market}||${legs.map((l) => `${l.outcome}:${l.slug}`).join(",")}`;
      out.push({
        id: hashId(key),
        kind: m.kind,
        matchId: m.matchId,
        sport: m.sport,
        market: m.market,
        outcomes: m.outcomes.length,
        profitPct: Math.round(profit * 1000) / 1000,
        legs,
        meta,
        bookmakers: [...new Set(legs.flatMap((l) => [l.slug, ...(l.alts ?? []).map((a) => a.slug)]))],
      });
      return;
    }
    for (const g of tops[i]) pick(i + 1, [...chosen, g]);
  };
  pick(0, []);
  return out.sort((a, b) => b.profitPct - a.profitPct).slice(0, MAX_COMBOS_PER_MARKET);
}

// прематч
interface PreRow {
  match_id: string;
  home: string;
  away: string;
  kickoff: Date;
  league: string;
  sport: string;
  bm_id: string;
  external_id: string;
  source_url: string | null;
  bm_updated: Date;
  slug: string;
}

async function loadPrematch(): Promise<MarketInput[]> {
  const rowsAll = await prisma.$queryRaw<PreRow[]>`
    SELECT m.id AS match_id, m."homeTeam" AS home, m."awayTeam" AS away, m."kickoffAt" AS kickoff, l.name AS league, s.slug AS sport,
           bm.id AS bm_id, bm."externalId" AS external_id, bm."sourceUrl" AS source_url, bm."updatedAt" AS bm_updated, b.slug AS slug
    FROM "Match" m
    JOIN "League" l ON l.id = m."leagueId"
    JOIN "Sport" s ON s.id = l."sportId"
    JOIN "BookmakerMatch" bm ON bm."matchId" = m.id
    JOIN "Bookmaker" b ON b.id = bm."bookmakerId"
    WHERE m."kickoffAt" > now() AND m."kickoffAt" < now() + interval '7 days' AND m."hiddenForAll" = false
      AND bm."updatedAt" > now() - interval '3 hours'
      AND s.slug IN ('football', 'hockey', 'tennis')`;
  // молчащие конторы
  const last = await prisma.$queryRaw<{ slug: string; sport: string; last: Date }[]>`
    SELECT b.slug AS slug, s.slug AS sport, max(bm."updatedAt") AS last
    FROM "BookmakerMatch" bm JOIN "Bookmaker" b ON b.id = bm."bookmakerId" JOIN "Match" m ON m.id = bm."matchId"
    JOIN "League" l ON l.id = m."leagueId" JOIN "Sport" s ON s.id = l."sportId"
    WHERE s.slug IN ('football', 'hockey', 'tennis') GROUP BY 1, 2`;
  const dead = new Set(last.filter((r) => Date.now() - r.last.getTime() > 30 * 60 * 1000).map((r) => r.slug + "|" + r.sport));
  const rows = rowsAll.filter((r) => !dead.has(r.slug + "|" + r.sport));
  // матчи хотя бы с двумя конторами
  const byMatch = new Map<string, PreRow[]>();
  for (const r of rows) (byMatch.get(r.match_id) ?? byMatch.set(r.match_id, []).get(r.match_id)!).push(r);
  const keep = [...byMatch.values()].filter((rs) => new Set(rs.map((r) => r.slug)).size >= 2);
  const bmIds = keep.flatMap((rs) => rs.map((r) => r.bm_id));
  if (!bmIds.length) return [];
  const snaps = await prisma.$queryRaw<{ bm_id: string; market: string; outcome: string; price: number; captured: Date }[]>`
    SELECT DISTINCT ON ("bookmakerMatchId", market, outcome) "bookmakerMatchId" AS bm_id, market::text AS market, outcome, price, "capturedAt" AS captured
    FROM "OddsSnapshot"
    WHERE "bookmakerMatchId" = ANY(${bmIds}) AND market IN ('MATCH_WINNER_1X2', 'MATCH_WINNER_2WAY')
    ORDER BY "bookmakerMatchId", market, outcome, "capturedAt" DESC`;
  const snapBy = new Map<string, { market: string; outcome: string; price: number; captured: Date }[]>();
  for (const s of snaps) (snapBy.get(s.bm_id) ?? snapBy.set(s.bm_id, []).get(s.bm_id)!).push(s);

  const out: MarketInput[] = [];
  for (const rs of keep) {
    const r0 = rs[0];
    const market = r0.sport === "tennis" ? "MATCH_WINNER_2WAY" : "MATCH_WINNER_1X2";
    const outcomes = market === "MATCH_WINNER_2WAY" ? ["1", "2"] : ["1", "X", "2"];
    const quotes: Record<string, Quote[]> = Object.fromEntries(outcomes.map((o) => [o, []]));
    for (const r of rs) {
      const ss = (snapBy.get(r.bm_id) ?? []).filter((s) => s.market === market);
      // у конторы должны быть ВСЕ исходы рынка, иначе её цены неполные (рынок мог закрыться частично)
      if (!outcomes.every((o) => ss.some((s) => s.outcome === o))) continue;
      for (const s of ss) {
        if (!quotes[s.outcome]) continue;
        quotes[s.outcome].push({ slug: r.slug, price: s.price, capturedAt: s.captured, confirmedAt: r.bm_updated, bmId: r.bm_id, externalId: r.external_id, sourceUrl: r.source_url });
      }
    }
    out.push({
      kind: "prematch",
      matchId: r0.match_id,
      sport: r0.sport,
      market,
      outcomes,
      quotes,
      meta: { home: r0.home, away: r0.away, league: r0.league, kickoffAt: r0.kickoff.toISOString(), ...leagueFlags(r0.sport, r0.league, r0.home, r0.away) },
    });
  }
  return out;
}

// live ---------- подтверждение цены по каждой конторе (пишет live-tracker-poll.ts после каждого тика)
function loadLiveConfirmed(): Record<string, Record<string, number>> {
  try {
    const j = JSON.parse(readFileSync(__dirname + "/.live-confirm.json", "utf8"));
    if (Date.now() - Number(j.at) > 120_000) return {};
    return j.t ?? {};
  } catch {
    return {};
  }
}

async function loadLive(): Promise<MarketInput[]> {
  const trackings = await prisma.liveTracking.findMany({
    where: { status: "TRACKING", lastPolledAt: { gt: new Date(Date.now() - 60_000) } },
    include: { match: { include: { league: { include: { sport: true } }, bookmakerMatches: { include: { bookmaker: true } } } } },
  });
  if (!trackings.length) return [];
  const evs = await prisma.$queryRaw<{ tracking_id: string; slug: string; p1: number; px: number | null; p2: number; unavailable: boolean; captured: Date }[]>`
    SELECT DISTINCT ON ("trackingId", "bookmakerSlug") "trackingId" AS tracking_id, "bookmakerSlug" AS slug, price1 AS p1, "priceX" AS px, price2 AS p2, unavailable, "capturedAt" AS captured
    FROM "LiveOddsEvent" WHERE "trackingId" = ANY(${trackings.map((t) => t.id)})
    ORDER BY "trackingId", "bookmakerSlug", "capturedAt" DESC`;
  const out: MarketInput[] = [];
  const confirmed = loadLiveConfirmed();
  for (const t of trackings) {
    const sport = t.match.league.sport.slug;
    const market = sport === "tennis" ? "MATCH_WINNER_2WAY" : "MATCH_WINNER_1X2";
    const outcomes = market === "MATCH_WINNER_2WAY" ? ["1", "2"] : ["1", "X", "2"];
    const quotes: Record<string, Quote[]> = Object.fromEntries(outcomes.map((o) => [o, []]));
    for (const e of evs.filter((x) => x.tracking_id === t.id)) {
      if (e.unavailable) continue;
      // Book G в режиме live_delay (их live-фид по этой лиге идёт с задержкой) - цена отстаёт от реальной, вилка с ней ложная
      if (e.slug === "bookg" && t.bookgDelayed) continue;
      if (market === "MATCH_WINNER_1X2" && !(e.px && e.px > 1)) continue;
      const bm = t.match.bookmakerMatches.find((b) => b.bookmaker.slug === e.slug);
      const conf = confirmed[t.id]?.[e.slug];
      const confirmedAt = conf && conf > e.captured.getTime() ? new Date(conf) : e.captured;
      const base = { slug: e.slug, capturedAt: e.captured, confirmedAt, bmId: bm?.id ?? null, externalId: bm?.externalId ?? null, sourceUrl: bm?.sourceUrl ?? null };
      quotes["1"].push({ ...base, price: Math.round(e.p1 * 1000) / 1000 });
      quotes["2"].push({ ...base, price: Math.round(e.p2 * 1000) / 1000 });
      if (market === "MATCH_WINNER_1X2") quotes["X"].push({ ...base, price: Math.round((e.px as number) * 1000) / 1000 });
    }
    out.push({
      kind: "live",
      matchId: t.matchId,
      sport,
      market,
      outcomes,
      quotes,
      meta: {
        home: t.match.homeTeam,
        away: t.match.awayTeam,
        league: t.match.league.name,
        kickoffAt: t.match.kickoffAt.toISOString(),
        trackingId: t.id,
        scoreHome: t.scoreHome,
        scoreAway: t.scoreAway,
        minute: t.matchMinute,
        timerSeconds: t.matchTimerSeconds,
        polledAt: t.lastPolledAt?.toISOString() ?? null,
        ...leagueFlags(sport, t.match.league.name, t.match.homeTeam, t.match.awayTeam),
      },
    });
  }
  return out;
}

// сохранение
async function persist(kind: Kind, forks: ComputedFork[]) {
  const now = new Date();
  // мету (все цены матча) целиком не читаем - сравниваем по короткой подписи qsig
  const existing = await prisma.fork.findMany({ where: { kind, active: true }, select: { id: true, profitPct: true, maxProfitPct: true, legs: true, qsig: true, lastSeenAt: true } });
  const quotesSig = (meta: unknown) =>
    hashId(JSON.stringify(((meta as { allQuotes?: unknown; minute?: unknown; scoreHome?: unknown; scoreAway?: unknown }) ?? {}), (k, v) => (k === "capturedAt" || k === "confirmedAt" || k === "polledAt" || k === "timerSeconds" ? undefined : v)));
  const exById = new Map(existing.map((e) => [e.id, e]));
  const seen = new Set(forks.map((f) => f.id));

  // новые (или вернувшиеся после исчезновения - жизнь начинается заново)
  const fresh = forks.filter((f) => !exById.has(f.id));
  if (fresh.length) {
    const ids = fresh.map((f) => f.id);
    await prisma.fork.deleteMany({ where: { id: { in: ids }, active: false } });
    await prisma.fork.createMany({
      data: fresh.map((f) => ({
        id: f.id,
        kind: f.kind,
        matchId: f.matchId,
        sport: f.sport,
        market: f.market,
        outcomes: f.outcomes,
        profitPct: f.profitPct,
        maxProfitPct: f.profitPct,
        legs: f.legs as unknown as object,
        meta: f.meta as object,
        qsig: quotesSig(f.meta),
        bookmakers: f.bookmakers,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
      skipDuplicates: true,
    });
  }
  // изменившиеся (цены/доход/мета) - обновляем; неизменные - только отметка "жива" не чаще раза в 30 с
  const changed: ComputedFork[] = [];
  const touch: string[] = [];
  for (const f of forks) {
    const e = exById.get(f.id);
    if (!e) continue;
    const prevLegs = e.legs as unknown as Leg[];
    // цены/время изменения цены - обновляем сразу; время подтверждения (опрос конторы)
    const legsChanged =
      JSON.stringify(prevLegs.map((l) => [l.price, l.capturedAt, (l.alts ?? []).map((a) => a.slug)])) !== JSON.stringify(f.legs.map((l) => [l.price, l.capturedAt, (l.alts ?? []).map((a) => a.slug)])) ||
      f.legs.some((l, i) => !prevLegs[i] || Date.parse(l.confirmedAt) - Date.parse(prevLegs[i].confirmedAt) > 60_000);
    const metaChanged = e.qsig !== quotesSig(f.meta);
    if (legsChanged || metaChanged || Math.abs(e.profitPct - f.profitPct) > 1e-9 || kind === "live") changed.push(f);
    else if (now.getTime() - e.lastSeenAt.getTime() > 30_000) touch.push(f.id);
  }
  for (let i = 0; i < changed.length; i += 100) {
    await prisma.$transaction(
      changed.slice(i, i + 100).map((f) =>
        prisma.fork.update({
          where: { id: f.id },
          data: {
            profitPct: f.profitPct,
            maxProfitPct: Math.max(f.profitPct, exById.get(f.id)!.maxProfitPct),
            legs: f.legs as unknown as object,
            meta: f.meta as object,
            qsig: quotesSig(f.meta),
            lastSeenAt: now,
          },
        })
      )
    );
  }
  if (touch.length) await prisma.fork.updateMany({ where: { id: { in: touch } }, data: { lastSeenAt: now } });
  // пропавшие
  const gone = existing.filter((e) => !seen.has(e.id)).map((e) => e.id);
  if (gone.length) await prisma.fork.updateMany({ where: { id: { in: gone } }, data: { active: false, endedAt: now } });
  return { total: forks.length, fresh: fresh.length, changed: changed.length, gone: gone.length };
}

async function scan(kind: Kind) {
  const t0 = Date.now();
  const markets = kind === "prematch" ? await loadPrematch() : await loadLive();
  const floor = kind === "prematch" ? PREMATCH_FLOOR : LIVE_FLOOR;
  const forks = markets.flatMap((m) => computeForks(m, floor));
  const r = await persist(kind, forks);
  return { ...r, markets: markets.length, ms: Date.now() - t0, positive: forks.filter((f) => f.profitPct > 0).length };
}

// журнал ставок: автоитог по финальному счёту
async function settleBets() {
  const open = await prisma.forkBet.findMany({ where: { status: "open" } });
  if (!open.length) return 0;
  let settled = 0;
  for (const b of open) {
    const tr = await prisma.liveTracking.findFirst({ where: { matchId: b.matchId, status: "FINISHED", scoreHome: { not: null }, scoreAway: { not: null } }, orderBy: { endedAt: "desc" } });
    if (!tr || tr.scoreHome == null || tr.scoreAway == null) continue;
    if (b.market !== "MATCH_WINNER_1X2" && b.market !== "MATCH_WINNER_2WAY") continue;
    const win = tr.scoreHome > tr.scoreAway ? "1" : tr.scoreHome < tr.scoreAway ? "2" : b.market === "MATCH_WINNER_1X2" ? "X" : null;
    if (!win) continue;
    const legs = b.legs as unknown as { outcome: string; price: number; stakeRub: number; net?: number }[];
    const ret = legs.filter((l) => l.outcome === win).reduce((s, l) => s + l.stakeRub * (l.net ?? l.price), 0);
    await prisma.forkBet.update({ where: { id: b.id }, data: { status: "settled", winOutcome: win, resultRub: Math.round((ret - b.totalStakeRub) * 100) / 100, settledBy: "auto", settledAt: new Date() } });
    settled++;
  }
  return settled;
}

async function loop(kind: Kind, every: number) {
  for (;;) {
    const started = Date.now();
    try {
      const r = await scan(kind);
      if (kind === "prematch" || r.fresh || r.gone) log(`[${kind}] рынков ${r.markets}, вилок ${r.total} (в плюсе ${r.positive}), новых ${r.fresh}, изменилось ${r.changed}, ушло ${r.gone}, ${r.ms} мс`);
    } catch (e) {
      log(`[${kind}] ошибка:`, (e as Error).message);
    }
    await new Promise((res) => setTimeout(res, Math.max(500, every - (Date.now() - started))));
  }
}

async function housekeeping() {
  for (;;) {
    try {
      const del = await prisma.fork.deleteMany({ where: { active: false, endedAt: { lt: new Date(Date.now() - KEEP_ENDED_MS) } } });
      const s = await settleBets();
      if (del.count || s) log(`[служебное] удалено старых вилок ${del.count}, закрыто ставок ${s}`);
    } catch (e) {
      log("[служебное] ошибка:", (e as Error).message);
    }
    await new Promise((res) => setTimeout(res, SETTLE_EVERY_MS));
  }
}

void isCryptoSlug; // (на будущее: правила только для крипто-контор)
void STALE_MS;
log("сканер вилок запущен");
loop("prematch", PREMATCH_EVERY_MS);
loop("live", LIVE_EVERY_MS);
housekeeping();
