// "Калибровка парсинга" - приём фото для Book B (само- починка через ИИ-зрение) и Book A/Book E/Book H/Book G
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { PHOTO_AUTO_BOOKMAKER, PHOTO_FLAG_BOOKMAKERS } from "@/lib/calibration";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();
const UPLOAD_DIR = `${process.env.BETMARK_HOME || process.cwd()}/calibration-uploads`;
const MAX_SIZE = 8 * 1024 * 1024; // 8 МБ - с запасом на обычный скриншот телефона
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "не удалось разобрать форму" }, { status: 400 });

  const bookmakerSlug = String(form.get("bookmakerSlug") || "");
  const sportSlug = String(form.get("sportSlug") || "football");
  const file = form.get("file");

  const allowedSlugs = [PHOTO_AUTO_BOOKMAKER, ...PHOTO_FLAG_BOOKMAKERS];
  if (!allowedSlugs.includes(bookmakerSlug as (typeof allowedSlugs)[number])) {
    return NextResponse.json({ error: `калибровка по фото не поддерживается для конторы "${bookmakerSlug}"` }, { status: 400 });
  }
  // Два разных права в зависимости от конторы
  const permKey = bookmakerSlug === PHOTO_AUTO_BOOKMAKER ? "calibration_submit_photo_auto" : "calibration_submit_photo_flag";
  const auth = await requirePerm(request, permKey);
  if (!auth.ok) return auth.response;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "нужен файл фото" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "файл слишком большой (максимум 8 МБ)" }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "поддерживаются только JPEG/PNG/WEBP" }, { status: 400 });
  }

  const bookmaker = await prisma.bookmaker.findUnique({ where: { slug: bookmakerSlug } });
  if (!bookmaker) {
    return NextResponse.json({ error: `контора "${bookmakerSlug}" не найдена в БД` }, { status: 400 });
  }

  mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  const photoPath = path.join(UPLOAD_DIR, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(photoPath, bytes);

  const submission = await prisma.calibrationSubmission.create({
    data: { bookmakerId: bookmaker.id, sportSlug, kind: "photo", photoPath, status: "PENDING" },
  });

  const child = spawn("npx", ["tsx", "verify-calibration.ts", submission.id], {
    cwd: (process.env.BETMARK_HOME || process.cwd()),
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return NextResponse.json({ id: submission.id, status: submission.status });
}
