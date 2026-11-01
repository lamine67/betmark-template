// Список удалённых матчей для вкладки "Статус -> Удалённые матчи" "mine"
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const hiddenRows = await prisma.hiddenMatch.findMany({ where: { username: auth.username }, select: { matchId: true, createdAt: true } });
  const hiddenAtById = new Map(hiddenRows.map((h) => [h.matchId, h.createdAt]));

  const select = { id: true, homeTeam: true, awayTeam: true, kickoffAt: true, hiddenAt: true, hiddenBy: true, league: { select: { name: true, sport: { select: { slug: true } } } } } as const;
  const [mineMatches, allMatches] = await Promise.all([
    hiddenAtById.size ? prisma.match.findMany({ where: { id: { in: [...hiddenAtById.keys()] }, kickoffAt: { gte: since } }, select, orderBy: { kickoffAt: "asc" } }) : Promise.resolve([]),
    prisma.match.findMany({ where: { hiddenForAll: true, kickoffAt: { gte: since } }, select, orderBy: { kickoffAt: "asc" } }),
  ]);

  const shape = (m: (typeof allMatches)[number], hiddenAt: Date | null, hiddenBy: string | null) => ({
    id: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    league: m.league.name,
    sport: m.league.sport.slug,
    kickoffAt: m.kickoffAt.toISOString(),
    hiddenAt: hiddenAt ? hiddenAt.toISOString() : null,
    hiddenBy,
  });
  return NextResponse.json({
    mine: mineMatches.map((m) => shape(m, hiddenAtById.get(m.id) ?? null, auth.username)),
    all: allMatches.map((m) => shape(m, m.hiddenAt, m.hiddenBy)),
  });
}
