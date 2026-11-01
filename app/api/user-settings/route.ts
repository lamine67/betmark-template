import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { CRYPTO_BOOKMAKER_SLUGS } from "@/lib/cryptoBooks";
import { getUserCryptoOnMain } from "@/lib/userSettings";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

// Личные настройки аккаунта какие крипто-конторы показывать в обычном Betmark (example.com)
async function bookmakerList() {
  const rows = await prisma.bookmaker.findMany({ where: { slug: { in: [...CRYPTO_BOOKMAKER_SLUGS] } }, orderBy: { name: "asc" } });
  return rows.map((b) => ({ slug: b.slug, name: b.name }));
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;
  const cryptoOnMain = [...(await getUserCryptoOnMain(prisma, auth.username))];
  return NextResponse.json({ cryptoOnMain, bookmakers: await bookmakerList() });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cryptoOnMain)) {
    return NextResponse.json({ error: "cryptoOnMain должен быть массивом" }, { status: 400 });
  }
  const cryptoOnMain = [...new Set<string>(body.cryptoOnMain.filter((s: unknown): s is string => typeof s === "string" && CRYPTO_BOOKMAKER_SLUGS.has(s)))];
  await prisma.userSetting.upsert({
    where: { username: auth.username },
    create: { username: auth.username, cryptoOnMain },
    update: { cryptoOnMain },
  });
  return NextResponse.json({ cryptoOnMain });
}
