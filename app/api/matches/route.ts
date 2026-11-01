import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { isTopLeague, isExcludedLeague, isWomenMatch } from "@/lib/topLeagues";
import { isTopTennisTournament } from "@/lib/topTennis";
import { isTopHockeyLeague, isFakeNhlMatch } from "@/lib/topHockey";
import { getPermsForRequest, getUsernameFromRequest } from "@/lib/betmarkPerms";
import { getUserCryptoOnMain } from "@/lib/userSettings";
import { staleCutoff, deadBookmakerIds, lastUpdateByBookmaker } from "@/lib/freshness";
import { isCryptoHost, isCryptoSlug } from "@/lib/cryptoBooks";
import { passesRegularBooksGate, regularBookCount } from "@/lib/regularBooks";
import { RESPONSE_TTL_MS, responseCache, inflight } from "@/lib/matchesCache";

const prisma = new PrismaClient();
const STALE_MAX_MS = 5 * 60_000;

export const dynamic = "force-dynamic";

function isCleanTopMatch(
  m: { homeTeam: string; awayTeam: string; league: string; kickoffAt: Date; bookmakerCount?: number },
  sportSlug: string
): boolean {
  if (sportSlug === "tennis") return isTopTennisTournament(m.league);
  if (sportSlug === "hockey") return isTopHockeyLeague(m.league) && !isFakeNhlMatch({ ...m, kickoffAt: m.kickoffAt });
  return isTopLeague(m.league) && !isWomenMatch(m) && !isExcludedLeague(m.league);
}

// Какие пары (рынок, исход) вообще бывают в снимках
let pairsCache: { at: number; markets: string[]; outcomes: string[] } | null = null;
async function marketOutcomePairs(): Promise<{ markets: string[]; outcomes: string[] }> {
  if (pairsCache && Date.now() - pairsCache.at < 3_600_000) return pairsCache;
  const base: [string, string][] = [["MATCH_WINNER_1X2", "1"], ["MATCH_WINNER_1X2", "X"], ["MATCH_WINNER_1X2", "2"], ["MATCH_WINNER_2WAY", "1"], ["MATCH_WINNER_2WAY", "2"]];
  const seen = new Set(base.map((p) => p.join("|")));
  try {
    const rows = await prisma.$queryRaw<{ market: string; outcome: string }[]>`
      SELECT DISTINCT market::text AS market, outcome FROM "OddsSnapshot" WHERE "capturedAt" > now() - interval '2 days'`;
    for (const r of rows) if (!seen.has(r.market + "|" + r.outcome)) { seen.add(r.market + "|" + r.outcome); base.push([r.market, r.outcome]); }
  } catch {
    // остаются базовые пары
  }
  pairsCache = { at: Date.now(), markets: base.map((p) => p[0]), outcomes: base.map((p) => p[1]) };
  return pairsCache;
}

async function computeMatches(request: NextRequest) {
  // Этим роутом пользуются И /board, И пикер матча на /live (topOnly=1) - поэтому проверяем "или", а не строго board_view
  const perms = await getPermsForRequest(request);
  if (!perms || !perms.hasAccess || !(perms.perms.board_view || perms.perms.live_view)) {
    return NextResponse.json({ error: "недостаточно прав" }, { status: 403 });
  }

  const sportSlug = request.nextUrl.searchParams.get("sport") || "football";
  const deadP = deadBookmakerIds(prisma, sportSlug);
  const lastP = lastUpdateByBookmaker(prisma, sportSlug);
  const pairsP = marketOutcomePairs();
  for (const p of [deadP, lastP, pairsP]) p.catch(() => {});
  // ?topOnly=1 - см. isCleanTopMatch выше
  const topOnly = request.nextUrl.searchParams.get("topOnly") === "1";
  const cryptoOnlyTop = isCryptoHost(request.headers) && request.nextUrl.searchParams.get("withCrypto") !== "1";

  const cutoff = staleCutoff();
  // Скрытые матчи: "у всех" (Match.hiddenForAll) и "только у этого аккаунта" (HiddenMatch)
  const viewerName = await getUsernameFromRequest(request);
  const hiddenIds = viewerName ? (await prisma.hiddenMatch.findMany({ where: { username: viewerName }, select: { matchId: true } })).map((h) => h.matchId) : [];
  const baseWhere = {
    kickoffAt: { gte: new Date() },
    hiddenForAll: false,
    ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
    league: { sport: { slug: sportSlug } },
  };
  let idFilter: string[] | null = null;
  if (topOnly || cryptoOnlyTop) {
    const lite = await prisma.$queryRaw<{ id: string; homeTeam: string; awayTeam: string; kickoffAt: Date; league: string; slugs: string[] | null; fresh: number }[]>`
      SELECT m.id, m."homeTeam", m."awayTeam", m."kickoffAt", l.name AS league,
             array_agg(DISTINCT b.slug) FILTER (WHERE bm."updatedAt" >= ${cutoff}) AS slugs,
             (count(bm.id) FILTER (WHERE bm."updatedAt" >= ${cutoff}))::int AS fresh
      FROM "Match" m
      JOIN "League" l ON l.id = m."leagueId"
      JOIN "Sport" s ON s.id = l."sportId"
      LEFT JOIN "BookmakerMatch" bm ON bm."matchId" = m.id
      LEFT JOIN "Bookmaker" b ON b.id = bm."bookmakerId"
      WHERE s.slug = ${sportSlug} AND m."kickoffAt" >= ${new Date()} AND m."hiddenForAll" = false AND m.id <> ALL(${hiddenIds}::text[])
      GROUP BY m.id, l.name`;
    idFilter = lite
      .filter(
        (m) =>
          isCleanTopMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league, kickoffAt: m.kickoffAt, bookmakerCount: m.fresh }, sportSlug) &&
          passesRegularBooksGate(m.slugs ?? [])
      )
      .map((m) => m.id);
  }

  const matches = await prisma.match.findMany({
    where: idFilter ? { id: { in: idFilter } } : baseWhere,
    orderBy: { kickoffAt: "asc" },
    include: {
      league: true,
      // только строки, которые контора обновляла за последние 3 часа (lib/freshness.ts) - устаревшие цены не показываем
      bookmakerMatches: { where: { updatedAt: { gte: cutoff } }, include: { bookmaker: true } },
    },
  });

  // молчащие конторы (сбор встал >30 мин) - цены не показываем, см. lib/freshness.ts
  const deadIds = await deadP;
  if (deadIds.size) for (const m of matches) m.bookmakerMatches = m.bookmakerMatches.filter((bm) => !deadIds.has(bm.bookmakerId));

  const bmIds = matches.flatMap((m) => m.bookmakerMatches.map((bm) => bm.id));
  // DISTINCT ON читал все ~30 снимков каждой строки (на 8,8 млн строк 4-5 с)
  const pairs = await pairsP;
  const snapRows = bmIds.length
    ? await prisma.$queryRaw<{ bookmakerMatchId: string; outcome: string; price: number; capturedAt: Date }[]>`
        SELECT ids.id AS "bookmakerMatchId", s.outcome, s.price, s."capturedAt"
        FROM unnest(${bmIds}::text[]) AS ids(id)
        CROSS JOIN unnest(${pairs.markets}::text[], ${pairs.outcomes}::text[]) AS mo(market, outcome)
        CROSS JOIN LATERAL (
          SELECT o.outcome, o.price, o."capturedAt" FROM "OddsSnapshot" o
          WHERE o."bookmakerMatchId" = ids.id AND o.market = mo.market::"MarketType" AND o.outcome = mo.outcome
          ORDER BY o."capturedAt" DESC LIMIT 1
        ) s`
    : [];
  const snapsByBm = new Map<string, { outcome: string; price: number; capturedAt: Date }[]>();
  for (const r of snapRows) {
    const list = snapsByBm.get(r.bookmakerMatchId);
    if (list) list.push(r);
    else snapsByBm.set(r.bookmakerMatchId, [r]);
  }
  for (const list of snapsByBm.values()) list.sort((x, y) => y.capturedAt.getTime() - x.capturedAt.getTime());

  const topFiltered = matches;

  // Крипто-конторы видны только на crypto.* (и ТОЛЬКО они там), на example.com - наоборот (см. lib/cryptoBooks.ts)
  const wantCrypto = isCryptoHost(request.headers);
  // ?withCrypto=1
  const withCrypto = request.nextUrl.searchParams.get("withCrypto") === "1";
  // Крипто-конторы, которые ЭТОТ аккаунт перенёс в обычный Betmark (страница "Статус")
  const username = await getUsernameFromRequest(request);
  const movedToMain = wantCrypto || withCrypto || !username ? new Set<string>() : await getUserCryptoOnMain(prisma, username);
  const visible = (slug: string) => withCrypto || (wantCrypto ? isCryptoSlug(slug) : !isCryptoSlug(slug) || movedToMain.has(slug));

  const result = topFiltered.map((m) => {
    const bookmakers = m.bookmakerMatches.filter((bm) => visible(bm.bookmaker.slug)).map((bm) => {
      // последний снэпшот по каждому исходу (1/X/2 у футбола, 1/2 у тенниса - X у тенниса всегда останется null, это ожидаемо)
      const latestByOutcome = new Map<string, number>();
      for (const snap of snapsByBm.get(bm.id) ?? []) {
        if (!latestByOutcome.has(snap.outcome)) {
          latestByOutcome.set(snap.outcome, snap.price);
        }
      }
      return {
        slug: bm.bookmaker.slug,
        name: bm.bookmaker.name,
        externalId: bm.externalId,
        sourceUrl: bm.sourceUrl,
        odds: {
          "1": latestByOutcome.get("1") ?? null,
          X: latestByOutcome.get("X") ?? null,
          "2": latestByOutcome.get("2") ?? null,
        },
      };
    });

    const distinctBookmakerCount = new Set(bookmakers.map((b) => b.slug)).size;

    return {
      id: m.id,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      kickoffAt: m.kickoffAt,
      league: m.league.name,
      bookmakerCount: distinctBookmakerCount,
      // число разных свежих ОБЫЧНЫХ контор (для правила "минимум 2" на клиенте, см. lib/regularBooks.ts)
      regularCount: regularBookCount(m.bookmakerMatches.map((bm) => bm.bookmaker.slug)),
      bookmakers,
      // "Помогите Betmark" - матч, которого ИИ-проверка сочла НЕ главным турниром лиги
      topLeagueFlagged: m.topLeagueFlagged,
      topLeagueReviewAnswer: m.topLeagueReviewAnswer,
    };
  });

  // Матч без единой конторы - "матч-призрак" (сирота)
  const withBookmakers = result.filter((m) => m.bookmakerCount > 0 && (!withCrypto || m.bookmakers.some((b) => !isCryptoSlug(b.slug))));

  const activeBookmakers = (await prisma.bookmaker.findMany({ where: { active: true } })).filter((b) => visible(b.slug));
  const bookmakerFreshness: Record<string, string | null> = {};
  const lastByBm = await lastP;
  const lastMap = new Map(lastByBm.map((r) => [r.bookmakerId, r.last]));
  for (const b of activeBookmakers) {
    const last = lastMap.get(b.id);
    bookmakerFreshness[b.slug] = last ? last.toISOString() : null;
  }

  return NextResponse.json({ matches: withBookmakers, bookmakerFreshness });
}

// кэш готового ответа на 30 секунд

export async function GET(request: NextRequest) {
  const username = await getUsernameFromRequest(request);
  if (!username) return computeMatches(request);
  const key = `${username}|${isCryptoHost(request.headers) ? "c" : "m"}|${request.nextUrl.search}`;
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < RESPONSE_TTL_MS) {
    return new NextResponse(hit.text, { status: hit.status, headers: { "Content-Type": "application/json" } });
  }
  // Устаревший (до 5 минут) ответ отдаём сразу, а свежий считается в фоне
  let staleOut: NextResponse | null = null;
  if (hit && Date.now() - hit.at < STALE_MAX_MS) {
    const perms = await getPermsForRequest(request);
    if (perms && perms.hasAccess && (perms.perms.board_view || perms.perms.live_view)) {
      staleOut = new NextResponse(hit.text, { status: hit.status, headers: { "Content-Type": "application/json" } });
    }
  }
  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      const res = await computeMatches(request);
      const text = await res.text();
      if (res.status === 200) {
        responseCache.set(key, { at: Date.now(), status: res.status, text });
        if (responseCache.size > 200) {
          const now = Date.now();
          for (const [k, v] of responseCache) if (now - v.at > RESPONSE_TTL_MS) responseCache.delete(k);
        }
      }
      return { status: res.status, text };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    job.catch(() => {});
  }
  if (staleOut) return staleOut;
  const out = await job;
  return new NextResponse(out.text, { status: out.status, headers: { "Content-Type": "application/json" } });
}
