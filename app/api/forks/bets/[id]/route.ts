// Ставка журнала: ручной итог (выигравший исход или возврат), заметка, повторное открытие, удаление
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { forksDb } from "../../_db";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const bet = await forksDb.forkBet.findFirst({ where: { id, username: auth.username } });
  if (!bet) return NextResponse.json({ error: "ставка не найдена" }, { status: 404 });
  const b = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof b.note === "string") data.note = b.note.slice(0, 500);
  if (b.reopen === true) Object.assign(data, { status: "open", winOutcome: null, resultRub: null, settledBy: null, settledAt: null });
  if (typeof b.winOutcome === "string") {
    const legs = bet.legs as unknown as { outcome: string; price: number; stakeRub: number; net?: number }[];
    let result: number;
    if (b.winOutcome === "void") result = 0;
    else {
      if (!legs.some((l) => l.outcome === b.winOutcome) && !["1", "X", "2"].includes(b.winOutcome)) {
        return NextResponse.json({ error: "неизвестный исход" }, { status: 400 });
      }
      const ret = legs.filter((l) => l.outcome === b.winOutcome).reduce((s, l) => s + l.stakeRub * (l.net ?? l.price), 0);
      result = ret - bet.totalStakeRub;
    }
    Object.assign(data, { status: "settled", winOutcome: b.winOutcome, resultRub: Math.round(result * 100) / 100, settledBy: "manual", settledAt: new Date() });
  }
  if (typeof b.resultRub === "number" && Number.isFinite(b.resultRub)) {
    Object.assign(data, { status: "settled", resultRub: Math.round(b.resultRub * 100) / 100, settledBy: "manual", settledAt: new Date() });
  }
  const row = await forksDb.forkBet.update({ where: { id }, data });
  return NextResponse.json({ bet: row });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const r = await forksDb.forkBet.deleteMany({ where: { id, username: auth.username } });
  return NextResponse.json({ deleted: r.count });
}
