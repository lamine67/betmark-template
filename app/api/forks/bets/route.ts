// Журнал ставок по вилкам (только свои)
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { forksDb } from "../_db";

export const dynamic = "force-dynamic";

interface LegIn {
  slug: string;
  outcome: string;
  price: number;
  stake: number;
  currency: string;
  stakeRub: number;
  net?: number;
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const rows = await forksDb.forkBet.findMany({ where: { username: auth.username }, orderBy: { createdAt: "desc" }, take: 1000 });
  const settled = rows.filter((r) => r.status === "settled" && r.resultRub != null);
  const stats = {
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    settled: settled.length,
    turnoverRub: Math.round(rows.reduce((s, r) => s + r.totalStakeRub, 0)),
    resultRub: Math.round(settled.reduce((s, r) => s + (r.resultRub ?? 0), 0) * 100) / 100,
    expectedOpenRub: Math.round(rows.filter((r) => r.status === "open").reduce((s, r) => s + r.expectedProfit, 0) * 100) / 100,
  };
  return NextResponse.json({ bets: rows, stats });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const b = await request.json().catch(() => null);
  const legs: LegIn[] = Array.isArray(b?.legs) ? b.legs : [];
  const okLegs =
    legs.length >= 2 &&
    legs.length <= 4 &&
    legs.every((l) => typeof l.slug === "string" && typeof l.outcome === "string" && l.price > 1 && l.stake > 0 && l.stakeRub > 0 && typeof l.currency === "string");
  if (!b || typeof b.matchId !== "string" || typeof b.market !== "string" || !okLegs) {
    return NextResponse.json({ error: "неполные данные ставки" }, { status: 400 });
  }
  const totalStakeRub = legs.reduce((s, l) => s + l.stakeRub, 0);
  const row = await forksDb.forkBet.create({
    data: {
      username: auth.username,
      forkId: typeof b.forkId === "string" ? b.forkId : null,
      kind: b.kind === "live" ? "live" : "prematch",
      matchId: b.matchId,
      sport: String(b.sport || ""),
      market: b.market,
      line: typeof b.line === "number" ? b.line : null,
      title: String(b.title || "").slice(0, 300),
      league: String(b.league || "").slice(0, 300),
      kickoffAt: b.kickoffAt ? new Date(b.kickoffAt) : null,
      legs: legs.map((l) => ({ slug: l.slug, outcome: l.outcome, price: l.price, stake: l.stake, currency: l.currency, stakeRub: l.stakeRub, net: l.net ?? l.price })) as object,
      totalStakeRub: Math.round(totalStakeRub * 100) / 100,
      expectedProfit: Number(b.expectedProfit) || 0,
      note: String(b.note || "").slice(0, 500),
    },
  });
  return NextResponse.json({ bet: row });
}
