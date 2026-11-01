// Удаление матча с доски scope "me" - скрыть только у этого аккаунта (HiddenMatch), scope "all"
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { clearMatchesCache } from "@/lib/matchesCache";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const matchId = typeof body?.matchId === "string" ? body.matchId : "";
  const scope = body?.scope === "all" ? "all" : body?.scope === "me" ? "me" : null;
  const restore = body?.restore === true;
  if (!matchId || !scope) return NextResponse.json({ error: "matchId и scope (me|all) обязательны" }, { status: 400 });

  const base = await requirePerm(request, "board_view");
  if (!base.ok) return base.response;
  if (scope === "all") {
    const all = await requirePerm(request, "match_delete_all");
    if (!all.ok) return NextResponse.json({ error: "нет права удалять матч у всех - включите «Удаление матча у ВСЕХ аккаунтов» в правах этого аккаунта" }, { status: 403 });
  }

  const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, homeTeam: true, awayTeam: true } });
  if (!match) return NextResponse.json({ error: "матч не найден" }, { status: 404 });

  if (scope === "me") {
    if (restore) await prisma.hiddenMatch.deleteMany({ where: { username: base.username, matchId } });
    else await prisma.hiddenMatch.upsert({ where: { username_matchId: { username: base.username, matchId } }, create: { username: base.username, matchId }, update: {} });
  } else {
    await prisma.match.update({
      where: { id: matchId },
      data: restore ? { hiddenForAll: false, hiddenAt: null, hiddenBy: null } : { hiddenForAll: true, hiddenAt: new Date(), hiddenBy: base.username },
    });
  }
  console.log(`matches/hide: ${base.username} ${restore ? "вернул" : "удалил"} (${scope}) ${match.homeTeam} - ${match.awayTeam} [${matchId}]`);
  clearMatchesCache(scope === "all" ? undefined : base.username);
  return NextResponse.json({ ok: true });
}
