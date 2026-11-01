import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { topLeagueKey, TOP_LEAGUE_NAMES, isExcludedLeague, isWomenMatch } from "../../../../lib/topLeagues";

const prisma = new PrismaClient();

const REFERENCE_BOOKMAKERS = ["booka", "booke"];
const ALL_BOOKMAKER_SLUGS = ["booka", "booke", "bookb", "bookc", "bookf", "bookd"];
const WINDOW_DAYS = 14;

export async function GET(request: NextRequest) {
  const token = request.headers.get("X-Internal-Token");
  if (!token || token !== process.env.INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const matches = await prisma.match.findMany({
    where: { kickoffAt: { gte: new Date(), lte: new Date(Date.now() + WINDOW_DAYS * 24 * 3600 * 1000) } },
    include: { league: true, bookmakerMatches: { include: { bookmaker: true } } },
  });

  // key = topLeagueKey (РПЛ/АПЛ/.../Лига чемпионов), value = Map<bookmakerSlug, count>
  const counts = new Map<string, Map<string, number>>();
  for (const m of matches) {
    if (
      isWomenMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name }) ||
      isExcludedLeague(m.league.name)
    ) {
      continue;
    }
    const key = topLeagueKey(m.league.name);
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, new Map());
    const bySlug = counts.get(key)!;
    for (const bm of m.bookmakerMatches) {
      bySlug.set(bm.bookmaker.slug, (bySlug.get(bm.bookmaker.slug) || 0) + 1);
    }
  }

  const leagues = TOP_LEAGUE_NAMES.map((name) => {
    const bySlug = counts.get(name) || new Map<string, number>();
    const countsObj: Record<string, number> = {};
    for (const slug of ALL_BOOKMAKER_SLUGS) countsObj[slug] = bySlug.get(slug) || 0;

    const referenceCounts = REFERENCE_BOOKMAKERS.map((s) => bySlug.get(s) || 0).filter((c) => c > 0);
    const referenceMax = referenceCounts.length ? Math.max(...referenceCounts) : 0;

    // Та же эвристика "пробел", что и в check-league-coverage.ts
    const missing: string[] = [];
    if (bySlug.size === 0) {
      missing.push(...ALL_BOOKMAKER_SLUGS);
    } else if (referenceMax > 0) {
      for (const slug of ALL_BOOKMAKER_SLUGS) {
        const count = bySlug.get(slug) || 0;
        if (count < referenceMax * 0.5) missing.push(slug);
      }
    }

    return {
      name,
      counts: countsObj,
      total_matches: Array.from(bySlug.values()).reduce((a, b) => a + b, 0),
      found: bySlug.size > 0,
      reference_max: referenceMax,
      missing_bookmakers: missing,
    };
  });

  const foundCount = leagues.filter((l) => l.found).length;

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    reference_bookmakers: REFERENCE_BOOKMAKERS,
    all_bookmakers: ALL_BOOKMAKER_SLUGS,
    total_top_leagues: TOP_LEAGUE_NAMES.length,
    found_count: foundCount,
    leagues,
  });
}
