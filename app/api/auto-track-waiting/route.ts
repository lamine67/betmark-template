// Список ожидания автослежения - показывает матчи
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { topLeagueKey, isExcludedLeague, isWomenMatch } from "@/lib/topLeagues";
import { topHockeyKey, isFakeNhlMatch } from "@/lib/topHockey";
import { requirePerm } from "@/lib/betmarkPerms";
import { staleCutoff } from "@/lib/freshness";
import { passesRegularBooksGate } from "@/lib/regularBooks";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

const FUTURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Небольшой запас НАЗАД от текущего момента
const PAST_GRACE_MS = 30 * 60 * 1000;

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "auto_track_view");
  if (!auth.ok) return auth.response;

  const configs = await prisma.autoTrackLeague.findMany({ where: { active: true } });
  if (configs.length === 0) return NextResponse.json({ waiting: [] });
  // матчи, скрытые этим аккаунтом (кнопка "Удалить" на доске) и удалённые у всех, в списке ожидания не нужны
  const hiddenIds = (await prisma.hiddenMatch.findMany({ where: { username: auth.username }, select: { matchId: true } })).map((h) => h.matchId);

  const now = Date.now();
  const waiting: {
    matchId: string;
    sportSlug: "football" | "hockey";
    leagueKey: string;
    home: string;
    away: string;
    kickoffAt: string;
    bookmakerCount: number;
    hasBooka: boolean;
  }[] = [];

  for (const sportSlug of ["football", "hockey"] as const) {
    const sportConfigs = configs.filter((c) => c.sportSlug === sportSlug);
    if (sportConfigs.length === 0) continue;
    const keyFn = sportSlug === "hockey" ? topHockeyKey : topLeagueKey;

    const candidates = await prisma.match.findMany({
      where: {
        league: { sport: { slug: sportSlug } },
        kickoffAt: { gte: new Date(now - PAST_GRACE_MS), lt: new Date(now + FUTURE_WINDOW_MS) },
        liveTracking: { none: { site: "main" } },
        hiddenForAll: false,
        ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
      },
      include: { league: true, bookmakerMatches: { include: { bookmaker: true } } },
    });

    for (const m of candidates) {
      const key = keyFn(m.league.name);
      const cfg = key != null ? sportConfigs.find((c) => c.leagueKey === key) : undefined;
      if (!cfg || !key) continue;
      if (m.topLeagueFlagged && m.topLeagueReviewAnswer !== true) continue; // как на доске: сомнительный матч скрыт, пока человек не подтвердил
      // чёрный список - матч, у которого меньше двух свежих ОБЫЧНЫХ контор, в автослежение не попадает (lib/regularBooks.ts)
      const cutoffFresh = staleCutoff();
      if (!passesRegularBooksGate(m.bookmakerMatches.filter((bm) => bm.updatedAt >= cutoffFresh).map((bm) => bm.bookmaker.slug))) continue;
      if (
        sportSlug === "hockey" &&
        isFakeNhlMatch({
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league.name,
          kickoffAt: m.kickoffAt,
          bookmakerCount: m.bookmakerMatches.length,
        })
      ) {
        continue;
      }
      if (sportSlug === "football" && (isExcludedLeague(m.league.name) || isWomenMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name }))) {
        continue;
      }
      waiting.push({
        matchId: m.id,
        sportSlug,
        leagueKey: key,
        home: m.homeTeam,
        away: m.awayTeam,
        kickoffAt: m.kickoffAt.toISOString(),
        bookmakerCount: m.bookmakerMatches.length,
        hasBooka: m.bookmakerMatches.some((bm) => bm.bookmaker.slug === "booka"),
      });
    }
  }

  waiting.sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  return NextResponse.json({ waiting });
}
