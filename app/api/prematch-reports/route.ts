// Список матчей для вкладки «Отчёты» те же матчи, что на доске
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { isTopLeague, isExcludedLeague, isWomenMatch } from "@/lib/topLeagues";
import { isTopTennisTournament } from "@/lib/topTennis";
import { isTopHockeyLeague, isFakeNhlMatch } from "@/lib/topHockey";
import { staleCutoff } from "@/lib/freshness";
import { passesRegularBooksGate } from "@/lib/regularBooks";
import { requirePerm } from "@/lib/betmarkPerms";

const g = globalThis as unknown as { __prematchListPrisma?: PrismaClient };
const prisma = g.__prematchListPrisma ?? new PrismaClient();
g.__prematchListPrisma = prisma;

export const dynamic = "force-dynamic";

const SPORTS = ["football", "hockey", "tennis"];
const MAX_ROWS = 600;

// то же, что isCleanTopMatch в app/api/matches/route.ts
function isCleanTop(m: { homeTeam: string; awayTeam: string; league: string; kickoffAt: Date }, sport: string): boolean {
  if (sport === "tennis") return isTopTennisTournament(m.league);
  if (sport === "hockey") return isTopHockeyLeague(m.league) && !isFakeNhlMatch({ ...m, kickoffAt: m.kickoffAt });
  return isTopLeague(m.league) && !isWomenMatch(m) && !isExcludedLeague(m.league);
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "reports_download_final");
  if (!auth.ok) return auth.response;
  const sport = request.nextUrl.searchParams.get("sport") || "football";
  if (!SPORTS.includes(sport)) return NextResponse.json({ error: "неизвестный вид спорта" }, { status: 400 });
  const past = request.nextUrl.searchParams.get("past") === "1";
  const now = new Date();
  const from = past ? new Date(now.getTime() - 30 * 86_400_000) : now;
  const to = past ? now : new Date(now.getTime() + 60 * 86_400_000);
  const cutoff = staleCutoff();
  const rows = await prisma.$queryRaw<{ id: string; homeTeam: string; awayTeam: string; kickoffAt: Date; league: string; slugs: string[] | null; n: number }[]>`
    SELECT m.id, m."homeTeam", m."awayTeam", m."kickoffAt", l.name AS league,
           array_agg(DISTINCT b.slug) FILTER (WHERE bm."updatedAt" >= ${cutoff}) AS slugs,
           count(DISTINCT b.slug)::int AS n
    FROM "Match" m
    JOIN "League" l ON l.id = m."leagueId"
    JOIN "Sport" s ON s.id = l."sportId"
    LEFT JOIN "BookmakerMatch" bm ON bm."matchId" = m.id
    LEFT JOIN "Bookmaker" b ON b.id = bm."bookmakerId"
    WHERE s.slug = ${sport} AND m."kickoffAt" >= ${from} AND m."kickoffAt" < ${to} AND m."hiddenForAll" = false
    GROUP BY m.id, l.name
    ORDER BY m."kickoffAt" ASC`;
  if (past) rows.reverse(); // прошедшие - свежие сверху
  const matches = rows
    .filter((m) => isCleanTop(m, sport) && (past ? m.n >= 2 : passesRegularBooksGate(m.slugs ?? [])))
    .slice(0, MAX_ROWS)
    .map((m) => ({ id: m.id, home: m.homeTeam, away: m.awayTeam, league: m.league, kickoffAt: m.kickoffAt, books: m.n }));
  return NextResponse.json({ matches });
}
