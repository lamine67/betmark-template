// Личные фильтры доски минимум контор с кэфами на матче
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { normalizeBoardPrefs } from "@/lib/matchQuality";

const g = globalThis as unknown as { __boardPrefsPrisma?: PrismaClient };
const prisma = g.__boardPrefsPrisma ?? new PrismaClient();
g.__boardPrefsPrisma = prisma;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;
  const row = await prisma.userSetting.findUnique({ where: { username: auth.username } });
  const board = (row?.livePrefs as { board?: unknown } | null)?.board;
  return NextResponse.json({ prefs: board ? normalizeBoardPrefs(board) : null });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;
  const text = await request.text();
  if (text.length > 10_000) return NextResponse.json({ error: "слишком большие настройки" }, { status: 413 });
  let body: { prefs?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "неверный JSON" }, { status: 400 });
  }
  const board = normalizeBoardPrefs(body?.prefs);
  const existing = await prisma.userSetting.findUnique({ where: { username: auth.username } });
  const prefs = { ...((existing?.livePrefs ?? {}) as Record<string, unknown>), board };
  await prisma.userSetting.upsert({
    where: { username: auth.username },
    create: { username: auth.username, cryptoOnMain: [], livePrefs: prefs as object },
    update: { livePrefs: prefs as object },
  });
  return NextResponse.json({ ok: true });
}
