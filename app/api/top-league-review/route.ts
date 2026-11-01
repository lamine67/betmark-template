import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

const SPORT_LABEL: Record<string, string> = { football: "Футбол", hockey: "Хоккей", tennis: "Теннис" };

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;

  const where = {
    topLeagueFlagged: true,
    topLeagueReviewAnswer: null,
  } as const;

  const [next, remaining] = await Promise.all([
    prisma.match.findFirst({
      where,
      orderBy: { kickoffAt: "asc" },
      include: { league: { include: { sport: true } } },
    }),
    prisma.match.count({ where }),
  ]);

  return NextResponse.json({
    next: next
      ? {
          id: next.id,
          homeTeam: next.homeTeam,
          awayTeam: next.awayTeam,
          league: next.league.name,
          sport: next.league.sport.slug,
          sportLabel: SPORT_LABEL[next.league.sport.slug] ?? next.league.sport.name,
          kickoffAt: next.kickoffAt,
          reason: next.topLeagueFlagReason,
        }
      : null,
    remaining,
  });
}
