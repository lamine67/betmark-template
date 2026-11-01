// "Калибровка парсинга" - приём ссылки на лигу для Book D/Book F/Book C
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { URL_BOOKMAKERS } from "@/lib/calibration";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

// Лёгкая проверка "ссылка хотя бы похожа на нужный сайт"
const EXPECTED_DOMAIN: Record<string, string> = {
  bookd: "bookd.ru",
  bookf: "bookf.ru",
  bookc: "bookc.ru",
};

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, "calibration_submit_url");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const bookmakerSlug = body?.bookmakerSlug;
  const sportSlug = body?.sportSlug || "football";
  const url = body?.url;

  if (!URL_BOOKMAKERS.includes(bookmakerSlug)) {
    return NextResponse.json({ error: `калибровка по ссылке не поддерживается для конторы "${bookmakerSlug}"` }, { status: 400 });
  }
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "нужна полная ссылка, начинающаяся с http(s)://" }, { status: 400 });
  }
  const expectedDomain = EXPECTED_DOMAIN[bookmakerSlug];
  if (expectedDomain && !url.includes(expectedDomain)) {
    return NextResponse.json({ error: `ссылка не похожа на сайт ${expectedDomain} - проверьте, что скопировали адрес именно с сайта ${bookmakerSlug}` }, { status: 400 });
  }

  const bookmaker = await prisma.bookmaker.findUnique({ where: { slug: bookmakerSlug } });
  if (!bookmaker) {
    return NextResponse.json({ error: `контора "${bookmakerSlug}" не найдена в БД` }, { status: 400 });
  }

  const submission = await prisma.calibrationSubmission.create({
    data: { bookmakerId: bookmaker.id, sportSlug, kind: "url", url, status: "PENDING" },
  });

  const child = spawn("npx", ["tsx", "verify-calibration.ts", submission.id], {
    cwd: (process.env.BETMARK_HOME || process.cwd()),
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ id: submission.id, status: submission.status });
}
