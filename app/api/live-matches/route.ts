// Список матчей, которые УЖЕ идут прямо сейчас
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { fetchBookaLiveOdds } from "@/lib/collectors/bookaLive";
import { fetchSnapshot } from "@/lib/collectors/booka";
import { isTopLeague, isWomenMatch, isExcludedLeague } from "@/lib/topLeagues";
import { isTopHockeyLeague, isFakeNhlMatch } from "@/lib/topHockey";
import { isTopTennisTournament } from "@/lib/topTennis";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

// Те же ориентиры длительности, что и TIMEOUT_MS в live-tracker-poll.ts (с запасом на перерывы/овертайм)
const CANDIDATE_WINDOW_MS: Record<string, number> = {
  football: 150 * 60 * 1000,
  hockey: 200 * 60 * 1000,
  tennis: 360 * 60 * 1000, // до 5 сетов
};
const DEFAULT_CANDIDATE_WINDOW_MS = 180 * 60 * 1000;

export async function GET(request: NextRequest) {
  // Этот список нужен ТОЛЬКО для секции "Лайв матчи" (подключение к уже идущему матчу)
  const auth = await requirePerm(request, "live_tracking_join_already_live");
  if (!auth.ok) return auth.response;

  const sportSlug = request.nextUrl.searchParams.get("sport") || "football";
  const windowMs = CANDIDATE_WINDOW_MS[sportSlug] ?? DEFAULT_CANDIDATE_WINDOW_MS;
  const now = new Date();

  // example.com: свой список - идущие матчи, которые есть в live-ленте Alpha (якорь)
  const candidates = await prisma.match.findMany({
    where: {
      league: { sport: { slug: sportSlug } },
      kickoffAt: { gte: new Date(now.getTime() - windowMs), lt: now },
    },
    include: {
      league: true,
      bookmakerMatches: { include: { bookmaker: true } },
    },
  });

  // Топ-лиги ТОЛЬКО
  const topCandidates = candidates.filter((m) => {
    // теннис: только ATP/WTA и турниры Большого шлема (lib/topTennis.ts, тот же фильтр, что на доске)
    if (sportSlug === "tennis") return isTopTennisTournament(m.league.name);
    if (sportSlug === "hockey") {
      return (
        isTopHockeyLeague(m.league.name) &&
        !isFakeNhlMatch({
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league.name,
          kickoffAt: m.kickoffAt,
          bookmakerCount: m.bookmakerMatches.length,
        })
      );
    }
    return (
      isTopLeague(m.league.name) &&
      !isWomenMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name }) &&
      !isExcludedLeague(m.league.name)
    );
  });

  const withBooka = topCandidates
    .map((m) => ({ match: m, bookaBm: m.bookmakerMatches.find((bm) => bm.bookmaker.slug === "booka") }))
    .filter(
      (c): c is { match: (typeof topCandidates)[number]; bookaBm: NonNullable<(typeof topCandidates)[number]["bookmakerMatches"][number]> } =>
        !!c.bookaBm
    );

  if (withBooka.length === 0) return NextResponse.json({ matches: [] });

  let snapshot;
  try {
    snapshot = await fetchSnapshot();
  } catch (e) {
    console.error("[live-matches] fetchSnapshot упал:", e);
    return NextResponse.json({ matches: [] });
  }

  // fetchBookaLiveOdds остаётся async-функцией
  const withOdds = await Promise.all(
    withBooka.map(async ({ match: m, bookaBm }) => {
      const odds = await fetchBookaLiveOdds(bookaBm.externalId, snapshot);
      if (!odds || odds.place !== "live") return null;
      return {
        id: m.id,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        league: m.league.name,
        kickoffAt: m.kickoffAt,
        bookmakerSlugs: m.bookmakerMatches.map((bm) => bm.bookmaker.slug),
        scoreHome: odds.scoreHome,
        scoreAway: odds.scoreAway,
        scoreDetail: odds.scoreDetail,
        matchMinute: odds.timerSeconds != null ? Math.floor(odds.timerSeconds / 60) : null,
      };
    })
  );
  const matches = withOdds.filter((r): r is NonNullable<typeof r> => r !== null);

  matches.sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());

  return NextResponse.json({ matches });
}

