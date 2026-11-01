// Настройка автослежения по лиге
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { MANDATORY_LIVE_ADAPTER, isLiveAdapterSlug, isCryptoLiveAdapterSlug, DEFAULT_LIVE_DETAIL_LEVEL, isLiveDetailLevel } from "@/lib/liveAdapters";
import { TOP_LEAGUE_NAMES } from "@/lib/topLeagues";
import { TOP_HOCKEY_NAMES } from "@/lib/topHockey";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "auto_track_view");
  if (!auth.ok) return auth.response;

  const configs = await prisma.autoTrackLeague.findMany();

  const build = (sportSlug: "football" | "hockey", names: readonly string[]) =>
    names.map((leagueKey) => ({
      sportSlug,
      leagueKey,
      config: configs.find((c) => c.sportSlug === sportSlug && c.leagueKey === leagueKey) ?? null,
    }));

  return NextResponse.json({
    leagues: [...build("football", TOP_LEAGUE_NAMES), ...build("hockey", TOP_HOCKEY_NAMES)],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, "auto_track_edit");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const sportSlug = body?.sportSlug;
  const leagueKey = body?.leagueKey;
  if ((sportSlug !== "football" && sportSlug !== "hockey") || typeof leagueKey !== "string" || !leagueKey) {
    return NextResponse.json({ error: "sportSlug и leagueKey обязательны" }, { status: 400 });
  }
  const validNames = sportSlug === "hockey" ? TOP_HOCKEY_NAMES : TOP_LEAGUE_NAMES;
  if (!(validNames as readonly string[]).includes(leagueKey)) {
    return NextResponse.json({ error: "неизвестная лига" }, { status: 400 });
  }

  const existing = await prisma.autoTrackLeague.findUnique({
    where: { sportSlug_leagueKey: { sportSlug, leagueKey } },
  });

  // bookmakers/detailLevel - опциональны в теле запроса
  let bookmakerSlugs = existing?.bookmakerSlugs ?? [MANDATORY_LIVE_ADAPTER];
  if (Array.isArray(body?.bookmakers)) {
    const requested = new Set<string>(body.bookmakers.filter((s: unknown): s is string => typeof s === "string" && (isLiveAdapterSlug(s) || isCryptoLiveAdapterSlug(s))));
    requested.add(MANDATORY_LIVE_ADAPTER);
    bookmakerSlugs = [...requested];
  }

  const detailLevel =
    typeof body?.detailLevel === "string" && isLiveDetailLevel(body.detailLevel) ? body.detailLevel : (existing?.detailLevel ?? DEFAULT_LIVE_DETAIL_LEVEL);

  const active = typeof body?.active === "boolean" ? body.active : (existing?.active ?? true);

  const config = await prisma.autoTrackLeague.upsert({
    where: { sportSlug_leagueKey: { sportSlug, leagueKey } },
    create: { sportSlug, leagueKey, active, bookmakerSlugs, detailLevel },
    update: { active, bookmakerSlugs, detailLevel },
  });

  return NextResponse.json({ config });
}
