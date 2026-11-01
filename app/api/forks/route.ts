// Сканер вилок: активные вилки (их считает отдельный процесс forks-scanner.ts, здесь только чтение)
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { forksDb, bookmakerNames } from "./_db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const kindParam = sp.get("kind") || "all";
  const kinds = kindParam === "prematch" || kindParam === "live" ? [kindParam] : ["prematch", "live"];
  const minProfitRaw = Number(sp.get("minProfit"));
  const minProfit = Number.isFinite(minProfitRaw) ? Math.max(-10, minProfitRaw) : -3;

  const rows = await forksDb.fork.findMany({
    where: { active: true, kind: { in: kinds }, profitPct: { gte: minProfit } },
    orderBy: { profitPct: "desc" },
    take: 6000,
  });
  const matches: Record<string, unknown> = {};
  for (const r of rows) if (!matches[`${r.kind}:${r.matchId}`]) matches[`${r.kind}:${r.matchId}`] = r.meta;
  const heartbeat = await forksDb.fork.groupBy({ by: ["kind"], _max: { lastSeenAt: true } });

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    scanner: Object.fromEntries(heartbeat.map((h) => [h.kind, h._max.lastSeenAt])),
    bookmakers: await bookmakerNames(),
    matches,
    forks: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      matchId: r.matchId,
      sport: r.sport,
      market: r.market,
      line: r.line,
      outcomes: r.outcomes,
      profitPct: r.profitPct,
      maxProfitPct: r.maxProfitPct,
      legs: r.legs,
      bookmakers: r.bookmakers,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
    })),
  });
}
