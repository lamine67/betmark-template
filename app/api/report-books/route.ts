import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_SLUGS } from "@/lib/liveAdapters";
import { PREMATCH_BOOK_ORDER } from "@/lib/prematchReport";

const g = globalThis as unknown as { __livePrefsPrisma?: PrismaClient };
const prisma = g.__livePrefsPrisma ?? new PrismaClient();
g.__livePrefsPrisma = prisma;

export const dynamic = "force-dynamic";

const ALL: string[] = [...(LIVE_ADAPTER_SLUGS as readonly string[]), ...(CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[])];

function clean(v: unknown): string[] {
  return Array.isArray(v) ? ALL.filter((slug) => v.includes(slug)) : [];
}
// отдельный набор контор для прематч-отчётов ?kind=prematch / body.kind, хранится в livePrefs.prematchBooks
function cleanPrematch(v: unknown): string[] {
  return Array.isArray(v) ? PREMATCH_BOOK_ORDER.filter((slug) => v.includes(slug)) : [];
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "live_view");
  if (!auth.ok) return auth.response;
  const row = await prisma.userSetting.findUnique({ where: { username: auth.username } });
  const prefs = (row?.livePrefs ?? {}) as { reportBooks?: unknown; reportPrepare?: unknown; prematchBooks?: unknown };
  if (request.nextUrl.searchParams.get("kind") === "prematch") return NextResponse.json({ books: cleanPrematch(prefs.prematchBooks) });
  return NextResponse.json({ books: clean(prefs.reportBooks), prepare: prefs.reportPrepare === true });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, "live_view");
  if (!auth.ok) return auth.response;
  let body: { books?: unknown; prepare?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "неверный JSON" }, { status: 400 });
  }
  if (body?.kind === "prematch") {
    const pb = cleanPrematch(body?.books);
    const allPm = pb.length === 0 || PREMATCH_BOOK_ORDER.every((slug) => pb.includes(slug));
    const cur = await prisma.userSetting.findUnique({ where: { username: auth.username } });
    const next = { ...((cur?.livePrefs ?? {}) as Record<string, unknown>) };
    if (allPm) delete next.prematchBooks;
    else next.prematchBooks = pb;
    await prisma.userSetting.upsert({
      where: { username: auth.username },
      create: { username: auth.username, cryptoOnMain: [], livePrefs: next as object },
      update: { livePrefs: next as object },
    });
    return NextResponse.json({ books: allPm ? [] : pb });
  }
  const books = clean(body?.books);
  const all = books.length === 0 || ALL.every((slug) => books.includes(slug));
  const row = await prisma.userSetting.findUnique({ where: { username: auth.username } });
  const prefs = { ...((row?.livePrefs ?? {}) as Record<string, unknown>) };
  // prepare: ответ на вопрос «будете часто менять выбор?» true = нет, набор постоянный
  if (all) {
    delete prefs.reportBooks;
    delete prefs.reportPrepare;
  } else {
    prefs.reportBooks = books;
    prefs.reportPrepare = body?.prepare === true;
  }
  await prisma.userSetting.upsert({
    where: { username: auth.username },
    create: { username: auth.username, cryptoOnMain: [], livePrefs: prefs as object },
    update: { livePrefs: prefs as object },
  });
  return NextResponse.json({ books: all ? [] : books, prepare: !all && body?.prepare === true });
}
