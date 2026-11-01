import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { isCryptoHost, isCryptoSlug } from "@/lib/cryptoBooks";
import { getUserCryptoOnMain } from "@/lib/userSettings";
import { staleCutoff, deadBookmakerIds } from "@/lib/freshness";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, "match_view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      league: { include: { sport: true } },
      bookmakerMatches: {
        where: { updatedAt: { gte: staleCutoff() } },
        include: {
          bookmaker: true,
          oddsSnapshots: { orderBy: { capturedAt: "desc" } },
        },
      },
    },
  });

  if (!match) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // молчащие конторы (сбор встал >30 мин) - цены не показываем, см. lib/freshness.ts
  const deadIds = await deadBookmakerIds(prisma, match.league.sport.slug);
  if (deadIds.size) match.bookmakerMatches = match.bookmakerMatches.filter((bm) => !deadIds.has(bm.bookmakerId));

  const movedToMain = isCryptoHost(request.headers) ? new Set<string>() : await getUserCryptoOnMain(prisma, auth.username);
  const bookmakers = match.bookmakerMatches
    .filter(
      (bm) =>
        bm.bookmaker.active &&
        (isCryptoHost(request.headers) ? isCryptoSlug(bm.bookmaker.slug) : !isCryptoSlug(bm.bookmaker.slug) || movedToMain.has(bm.bookmaker.slug))
    )
    .map((bm) => {
    const latestByOutcome = new Map<string, number>();
    for (const snap of bm.oddsSnapshots) {
      if (!latestByOutcome.has(snap.outcome)) {
        latestByOutcome.set(snap.outcome, snap.price);
      }
    }
    return {
      slug: bm.bookmaker.slug,
      name: bm.bookmaker.name,
      externalId: bm.externalId,
      sourceUrl: bm.sourceUrl,
      rawHomeTeam: bm.rawHomeTeam,
      rawAwayTeam: bm.rawAwayTeam,
      odds: {
        "1": latestByOutcome.get("1") ?? null,
        X: latestByOutcome.get("X") ?? null,
        "2": latestByOutcome.get("2") ?? null,
      },
      history: bm.oddsSnapshots.slice(0, 60).map((s) => ({
        outcome: s.outcome,
        price: s.price,
        capturedAt: s.capturedAt,
      })),
    };
  });

  return NextResponse.json({
    id: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    kickoffAt: match.kickoffAt,
    league: match.league.name,
    bookmakers,
  });
}
