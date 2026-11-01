// "Калибровка парсинга" - удаление заявки (кнопка "Убрать" в списке на /status)
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { unlinkSync } from "fs";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, "calibration_delete");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const sub = await prisma.calibrationSubmission.findUnique({ where: { id } });
  if (!sub) return NextResponse.json({ error: "не найдено" }, { status: 404 });

  if (sub.photoPath) {
    try {
      unlinkSync(sub.photoPath);
    } catch {
      // файла уже могло не быть - не критично, продолжаем удаление записи
    }
  }
  await prisma.calibrationSubmission.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
