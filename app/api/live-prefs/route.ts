// Личные настройки страницы /live какие отслеживания скрыты у этого аккаунта
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

const g = globalThis as unknown as { __livePrefsPrisma?: PrismaClient };
const prisma = g.__livePrefsPrisma ?? new PrismaClient();
g.__livePrefsPrisma = prisma;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "live_view");
  if (!auth.ok) return auth.response;
  const row = await prisma.userSetting.findUnique({ where: { username: auth.username } });
  return NextResponse.json({ prefs: row?.livePrefs ?? null });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, "live_view");
  if (!auth.ok) return auth.response;
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: "слишком большие настройки" }, { status: 413 });
  let body: { prefs?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "неверный JSON" }, { status: 400 });
  }
  if (!body || typeof body.prefs !== "object" || body.prefs === null || Array.isArray(body.prefs)) {
    return NextResponse.json({ error: "prefs должен быть объектом" }, { status: 400 });
  }
  // набор контор для отчётов (/api/report-books) живёт в тех же настройках, но правится отдельно
  const existing = await prisma.userSetting.findUnique({ where: { username: auth.username } });
  const kept = (existing?.livePrefs ?? {}) as { reportBooks?: unknown; reportPrepare?: unknown; board?: unknown };
  const prefs = { ...(body.prefs as Record<string, unknown>) };
  delete prefs.reportBooks;
  delete prefs.reportPrepare;
  delete prefs.board;
  if (Array.isArray(kept.reportBooks)) prefs.reportBooks = kept.reportBooks;
  if (typeof kept.reportPrepare === "boolean") prefs.reportPrepare = kept.reportPrepare;
  // фильтры доски (/api/board-prefs) живут здесь же - страница /live их не знает и не должна стирать
  if (kept.board && typeof kept.board === "object") prefs.board = kept.board;
  await prisma.userSetting.upsert({
    where: { username: auth.username },
    create: { username: auth.username, cryptoOnMain: [], livePrefs: prefs as object },
    update: { livePrefs: prefs as object },
  });
  return NextResponse.json({ ok: true });
}
