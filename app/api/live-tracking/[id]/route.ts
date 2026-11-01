import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  LIVE_ADAPTER_SLUGS,
  MANDATORY_LIVE_ADAPTER,
  isLiveAdapterSlug,
  isLiveDetailLevel,
  isCryptoLiveAdapterSlug,
  parseAnchor,
} from "@/lib/liveAdapters";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (body?.action === "update") {
    const editAuth = await requirePerm(request, "live_tracking_edit");
    if (!editAuth.ok) return editAuth.response;

    const tracking = await prisma.liveTracking.findUnique({ where: { id } });
    if (!tracking) {
      return NextResponse.json({ error: "не найдено" }, { status: 404 });
    }
    // Пока матч не начался - у поллера ещё нет ни одной записанной строки для этого трекинга
    if (tracking.status !== "SCHEDULED") {
      return NextResponse.json({ error: "изменить конторы/подробность можно только пока матч ещё не начался" }, { status: 400 });
    }

    // Та же логика валидации, что и при создании (POST /api/live-tracking)
    if (Array.isArray(body?.bookmakers)) {
      const bookmakersAuth = await requirePerm(request, "live_tracking_choose_bookmakers");
      if (!bookmakersAuth.ok) return bookmakersAuth.response;
    }
    if (typeof body?.detailLevel === "string" && isLiveDetailLevel(body.detailLevel)) {
      const levelAuth = await requirePerm(request, "live_tracking_choose_detail_level");
      if (!levelAuth.ok) return levelAuth.response;
      if (body.detailLevel === "ULTRA") {
        const ultraAuth = await requirePerm(request, "live_tracking_choose_ultra");
        if (!ultraAuth.ok) return ultraAuth.response;
      }
    }
    const requestedRaw = Array.isArray(body?.bookmakers) ? body.bookmakers : LIVE_ADAPTER_SLUGS;
    const requested = new Set<string>(
      requestedRaw.filter((s: unknown): s is string => typeof s === "string" && (isLiveAdapterSlug(s) || isCryptoLiveAdapterSlug(s)))
    );
    const anchor = parseAnchor(tracking.bookaEventId);
    requested.add(anchor.kind === "alpha" ? anchor.slug : MANDATORY_LIVE_ADAPTER);
    const bookmakerSlugs = [...requested];
    const detailLevel = typeof body?.detailLevel === "string" && isLiveDetailLevel(body.detailLevel) ? body.detailLevel : tracking.detailLevel;

    const updated = await prisma.liveTracking.update({ where: { id }, data: { bookmakerSlugs, detailLevel } });
    return NextResponse.json({ tracking: updated });
  }

  if (body?.action !== "stop") {
    return NextResponse.json({ error: "неизвестное действие" }, { status: 400 });
  }

  const stopAuth = await requirePerm(request, "live_tracking_stop");
  if (!stopAuth.ok) return stopAuth.response;

  const tracking = await prisma.liveTracking.findUnique({ where: { id } });
  if (!tracking) {
    return NextResponse.json({ error: "не найдено" }, { status: 404 });
  }
  if (tracking.status !== "SCHEDULED" && tracking.status !== "TRACKING") {
    return NextResponse.json({ error: "остановка возможна только для активного отслеживания" }, { status: 400 });
  }

  if (tracking.status === "TRACKING") {
    // Уже есть хотя бы одна запись LiveOddsEvent (создаётся сразу при переходе в TRACKING)
    await prisma.liveTracking.update({
      where: { id },
      data: { status: "FINISHED", endedAt: new Date(), endReason: "остановлено вручную" },
    });
    const child = spawn("npx", ["tsx", "generate-live-report.ts", id], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    // SCHEDULED без единой записи - строить отчёт не из чего
    await prisma.liveTracking.update({
      where: { id },
      data: { status: "FAILED", endReason: "отменено вручную (до начала отслеживания)" },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, "live_tracking_remove");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const tracking = await prisma.liveTracking.findUnique({ where: { id } });
  if (!tracking) {
    return NextResponse.json({ error: "не найдено" }, { status: 404 });
  }
  if (tracking.status === "TRACKING") {
    return NextResponse.json({ error: "сначала остановите отслеживание" }, { status: 400 });
  }

  if (tracking.reportPath) {
    try {
      fs.unlinkSync(tracking.reportPath);
    } catch {
      // файла уже могло не быть - не критично
    }
  }
  // "Сырой" (без ИИ) отчёт ULTRA - тот же принцип очистки
  if (tracking.reportPathRaw) {
    try {
      fs.unlinkSync(tracking.reportPathRaw);
    } catch {
      // файла уже могло не быть - не критично
    }
  }
  // Live-снимок ("посмотреть PDF пока матч идёт") мог остаться на диске
  try {
    fs.unlinkSync(path.join(process.cwd(), "reports", `${id}.live.pdf`));
  } catch {
    // не было и не надо
  }
  // готовые отчёты по наборам контор и ответ ИИ лежат рядом с отчётом - убираем вместе с ним
  try {
    const dir = path.join(process.cwd(), "reports");
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${id}.`) && (/\.sel-[a-f0-9]+\.pdf$/.test(f) || f.endsWith(".ai.json"))) fs.unlinkSync(path.join(dir, f));
    }
  } catch {
  }
  await prisma.liveTracking.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
