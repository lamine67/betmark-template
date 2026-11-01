// Список и создание отслеживаний (проект, вкладка "Live-трекер")
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  LIVE_ADAPTER_SLUGS,
  MANDATORY_LIVE_ADAPTER,
  isLiveAdapterSlug,
  DEFAULT_LIVE_DETAIL_LEVEL,
  isLiveDetailLevel, TENNIS_LIVE_ADAPTER_SLUGS } from "@/lib/liveAdapters";
import { requirePerm } from "@/lib/betmarkPerms";
import { CRYPTO_ANCHOR_ORDER, isCryptoLiveAdapterSlug, formatAlphaAnchor } from "@/lib/liveAdapters";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "live_view");
  if (!auth.ok) return auth.response;

  const rows = await prisma.liveTracking.findMany({
    orderBy: { createdAt: "desc" },
    take: 1000,
    include: { match: { include: { league: { include: { sport: true } } } } },
  });

  const eventGroups = await prisma.liveOddsEvent.groupBy({
    by: ["trackingId", "bookmakerSlug"],
    where: { trackingId: { in: rows.map((r) => r.id) } },
  });
  const actualCountByTracking = new Map<string, number>();
  for (const g of eventGroups) {
    actualCountByTracking.set(g.trackingId, (actualCountByTracking.get(g.trackingId) ?? 0) + 1);
  }

  // Последние цены контор по идущим отслеживаниям карточка "идёт live" на /live)
  const trackingIds = rows.filter((r) => r.status === "TRACKING").map((r) => r.id);
  type OddsRow = {
    slug: string;
    unavailable: boolean;
    price1: number | null;
    priceX: number | null;
    price2: number | null;
    t1: string | null;
    tX: string | null;
    t2: string | null;
  };
  const oddsByTracking = new Map<string, OddsRow[]>();
  if (trackingIds.length > 0) {
    const sel = { trackingId: true, bookmakerSlug: true, price1: true, priceX: true, price2: true, unavailable: true, capturedAt: true } as const;
    // последняя запись каждой конторы (distinct - независимо от того, как давно она была: запись пишется при изменении цены)
    const latestEvs = await prisma.liveOddsEvent.findMany({
      where: { trackingId: { in: trackingIds } },
      orderBy: { capturedAt: "desc" },
      distinct: ["trackingId", "bookmakerSlug"],
      select: sel,
    });
    // недавние записи - только для стрелок динамики
    const recentEvs = await prisma.liveOddsEvent.findMany({
      where: { trackingId: { in: trackingIds }, capturedAt: { gte: new Date(Date.now() - 20 * 60 * 1000) } },
      orderBy: { capturedAt: "desc" },
      take: 500 * trackingIds.length,
      select: sel,
    });
    const recentBy = new Map<string, typeof recentEvs>();
    for (const e of recentEvs) {
      const k = e.trackingId + "|" + e.bookmakerSlug;
      const arr = recentBy.get(k);
      if (arr) arr.push(e);
      else recentBy.set(k, [e]);
    }
    const latestBy = new Map<string, (typeof latestEvs)[number]>();
    for (const e of latestEvs) latestBy.set(e.trackingId + "|" + e.bookmakerSlug, e);
    const TREND_WINDOW_MS = 10 * 60 * 1000;
    const order = [...LIVE_ADAPTER_SLUGS, ...CRYPTO_ANCHOR_ORDER] as string[];
    for (const r of rows) {
      if (r.status !== "TRACKING") continue;
      const slugs = [...r.bookmakerSlugs].sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99));
      const out: OddsRow[] = [];
      for (const slug of slugs) {
        const k = r.id + "|" + slug;
        const last = latestBy.get(k);
        if (!last || last.unavailable) {
          out.push({ slug, unavailable: true, price1: null, priceX: null, price2: null, t1: null, tX: null, t2: null });
          continue;
        }
        const list = recentBy.get(k) ?? [];
        const trend = (get: (e: (typeof latestEvs)[number]) => number | null | undefined): string | null => {
          const cur = get(last);
          if (cur == null) return null;
          for (const e of list) {
            if (e.capturedAt.getTime() >= last.capturedAt.getTime()) continue; // сама последняя запись
            if (last.capturedAt.getTime() - e.capturedAt.getTime() > TREND_WINDOW_MS) break;
            if (e.unavailable) continue;
            const v = get(e);
            if (v != null && v !== cur) return cur > v ? "up" : "down";
          }
          return null;
        };
        out.push({ slug, unavailable: false, price1: last.price1, priceX: last.priceX, price2: last.price2, t1: trend((e) => e.price1), tX: trend((e) => e.priceX), t2: trend((e) => e.price2) });
      }
      oddsByTracking.set(r.id, out);
    }
  }

  return NextResponse.json({
    trackings: rows.map((r) => ({
      id: r.id,
      liveOdds: oddsByTracking.get(r.id) ?? [],
      status: r.status,
      matchId: r.matchId,
      homeTeam: r.match.homeTeam,
      awayTeam: r.match.awayTeam,
      sport: r.match.league.sport.slug,
      league: r.match.league.name,
      kickoffAt: r.match.kickoffAt,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      endReason: r.endReason,
      scoreHome: r.scoreHome,
      scoreAway: r.scoreAway,
      matchMinute: r.matchMinute,
      scoreDetail: r.scoreDetail,
      matchTimerSeconds: r.matchTimerSeconds,
      source: r.source,
      bookmakerSlugs: r.bookmakerSlugs,
      actualBookmakerCount: actualCountByTracking.get(r.id) ?? 0,
      detailLevel: r.detailLevel,
      hasReport: !!r.reportPath,
      hasReportRaw: !!r.reportPathRaw,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const matchId = body?.matchId;
  if (typeof matchId !== "string" || !matchId) {
    return NextResponse.json({ error: "matchId обязателен" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) {
    return NextResponse.json({ error: "матч не найден" }, { status: 404 });
  }

  // Тот же роут обслуживает и "запустить новое отслеживание" (кикофф в будущем)
  const isJoinAlreadyLive = match.kickoffAt.getTime() <= Date.now();
  const startAuth = await requirePerm(request, isJoinAlreadyLive ? "live_tracking_join_already_live" : "live_tracking_start");
  if (!startAuth.ok) return startAuth.response;

  // Book A - обязательная "якорная" контора (см. проект - именно её live-статус запускает трекинг)
  const bookaBm = await prisma.bookmakerMatch.findFirst({
    where: { matchId, bookmaker: { slug: "booka" } },
  });
  // Якорь: Book A
  let anchorValue: string | null = bookaBm?.externalId ?? null;
  let anchorSlug = MANDATORY_LIVE_ADAPTER as string;
  if (!bookaBm) {
    const cryptoBms = await prisma.bookmakerMatch.findMany({
      where: { matchId, bookmaker: { slug: { in: [...CRYPTO_ANCHOR_ORDER] } } },
      include: { bookmaker: true },
    });
    const anchorBm = CRYPTO_ANCHOR_ORDER.map((slug) => cryptoBms.find((b) => b.bookmaker.slug === slug)).find((b) => !!b);
    if (!anchorBm) {
      return NextResponse.json(
        { error: "нет коэффициентов Book A для этого матча - отслеживание невозможно" },
        { status: 400 }
      );
    }
    anchorSlug = anchorBm.bookmaker.slug;
    anchorValue = formatAlphaAnchor(anchorSlug, anchorBm.externalId);
  }

  if (Array.isArray(body?.bookmakers)) {
    const bookmakersAuth = await requirePerm(request, "live_tracking_choose_bookmakers");
    if (!bookmakersAuth.ok) return bookmakersAuth.response;
  }
  const requestedRaw = Array.isArray(body?.bookmakers) ? body.bookmakers : LIVE_ADAPTER_SLUGS;
  // теннис только конторы, у которых live-адаптер умеет теннис; крипто-конторы для тенниса пока не подключены
  const matchSport = await prisma.match.findUnique({ where: { id: matchId }, select: { league: { select: { sport: { select: { slug: true } } } } } });
  const isTennis = matchSport?.league.sport.slug === "tennis";
  const requested = new Set<string>(
    requestedRaw.filter(
      (s: unknown): s is string =>
        typeof s === "string" && (isLiveAdapterSlug(s) || isCryptoLiveAdapterSlug(s)) && (!isTennis || TENNIS_LIVE_ADAPTER_SLUGS.includes(s))
    )
  );
  requested.add(anchorSlug);
  const bookmakerSlugs = [...requested];

  if (typeof body?.detailLevel === "string" && isLiveDetailLevel(body.detailLevel)) {
    const levelAuth = await requirePerm(request, "live_tracking_choose_detail_level");
    if (!levelAuth.ok) return levelAuth.response;
    if (body.detailLevel === "ULTRA") {
      const ultraAuth = await requirePerm(request, "live_tracking_choose_ultra");
      if (!ultraAuth.ok) return ultraAuth.response;
    }
  }
  const detailLevel = typeof body?.detailLevel === "string" && isLiveDetailLevel(body.detailLevel) ? body.detailLevel : DEFAULT_LIVE_DETAIL_LEVEL;

  try {
    const tracking = await prisma.liveTracking.create({
      data: { matchId, bookaEventId: anchorValue, status: "SCHEDULED", bookmakerSlugs, detailLevel },
    });
    return NextResponse.json({ tracking });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "этот матч уже отслеживается" }, { status: 409 });
    }
    throw e;
  }
}

