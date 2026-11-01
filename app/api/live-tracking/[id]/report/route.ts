// Скачивание PDF-отчёта (проект)
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

function pdfResponse(buf: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function subsetKey(books: string[]): string {
  return crypto.createHash("sha1").update([...books].sort().join(",")).digest("hex").slice(0, 12);
}

// личный набор контор того аккаунта, который скачивает (/status -> Отчёты и кнопка на /live; /api/report-books)
async function userReportBooks(username: string, trackingSlugs: string[]): Promise<string[] | null> {
  try {
    const row = await prisma.userSetting.findUnique({ where: { username } });
    const want = (row?.livePrefs as { reportBooks?: unknown } | null)?.reportBooks;
    if (!Array.isArray(want)) return null;
    const use = trackingSlugs.filter((s) => want.includes(s));
    return use.length > 0 && use.length < trackingSlugs.length ? use : null;
  } catch {
    return null;
  }
}

function selectedPdf(id: string, books: string[], kind: "final" | "raw" | "live", finished: boolean): NextResponse {
  const key = finished ? subsetKey(books) : crypto.randomBytes(6).toString("hex");
  const dir = path.join(process.cwd(), "reports");
  const name = kind === "raw" ? `${id}.raw.sel-${key}.pdf` : kind === "live" ? `${id}.live.sel-${key}.pdf` : `${id}.sel-${key}.pdf`;
  const file = path.join(dir, name);
  const outName = `${id}${kind === "raw" ? ".raw" : kind === "live" ? "-live" : ""}-${books.length}-kontor.pdf`;
  try {
    if (finished && fs.existsSync(file)) return pdfResponse(fs.readFileSync(file), outName);
    // tsx напрямую, без npx: на пару секунд быстрее холодный старт
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const bin = fs.existsSync(tsx) ? tsx : "npx";
    const args = fs.existsSync(tsx) ? ["generate-live-report.ts", id, books.join(","), key] : ["tsx", "generate-live-report.ts", id, books.join(","), key];
    const result = spawnSync(bin, args, { cwd: process.cwd(), encoding: "utf-8", timeout: finished ? 130000 : 45000 });
    if (result.status !== 0) {
      console.error(`[${id}] отчёт по выбранным конторам не собрался:`, result.stdout, result.stderr);
      return NextResponse.json({ error: "не удалось собрать отчёт по выбранным конторам (возможно, у них нет данных в этом матче)" }, { status: 500 });
    }
    return pdfResponse(fs.readFileSync(file), outName);
  } catch {
    return NextResponse.json({ error: "не удалось прочитать сформированный отчёт" }, { status: 500 });
  } finally {
    if (!finished) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* нет такого файла - нормально */
      }
    }
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tracking = await prisma.liveTracking.findUnique({ where: { id } });
  if (!tracking) {
    return NextResponse.json({ error: "не найдено" }, { status: 404 });
  }
  // выбранные конторы: только slug из самого отслеживания (чужие и мусор отбрасываются). ?books=all
  const booksParam = request.nextUrl.searchParams.get("books");
  let books: string[] | null = null;
  if (booksParam && booksParam !== "all") {
    books = booksParam.split(",").filter((s) => /^[a-z0-9]{2,20}$/.test(s) && tracking.bookmakerSlugs.includes(s)).slice(0, 30);
    if (books.length === 0) return NextResponse.json({ error: "не выбрано ни одной конторы из этого отслеживания" }, { status: 400 });
    if (tracking.bookmakerSlugs.every((s) => books!.includes(s))) books = null; // выбраны все - это обычный полный отчёт
  }
  const useUserDefault = !booksParam;

  if (request.nextUrl.searchParams.get("variant") === "raw") {
    // "Сырой" отчёт существует только у ULTRA - право на его скачивание завязано на само право выбрать ULTRA
    const rawAuth = await requirePerm(request, "reports_download_final");
    if (!rawAuth.ok) return rawAuth.response;
    if (!rawAuth.perms.live_tracking_choose_ultra) {
      return NextResponse.json({ error: "недостаточно прав для скачивания ULTRA-отчёта" }, { status: 403 });
    }
    const rawBooks = books ?? (useUserDefault ? await userReportBooks(rawAuth.username, tracking.bookmakerSlugs) : null);
    if (tracking.status === "FINISHED" && tracking.reportPathRaw && rawBooks) return selectedPdf(id, rawBooks, "raw", true);
    if (tracking.status === "FINISHED" && tracking.reportPathRaw) {
      try {
        return pdfResponse(fs.readFileSync(tracking.reportPathRaw), `${tracking.id}.raw.pdf`);
      } catch {
        return NextResponse.json({ error: "файл отчёта отсутствует на диске" }, { status: 404 });
      }
    }
    return NextResponse.json({ error: "\"сырой\" отчёт без ИИ доступен только для завершённого отслеживания уровня ULTRA" }, { status: 404 });
  }

  if (tracking.status === "FINISHED" && tracking.reportPath) {
    const finalAuth = await requirePerm(request, "reports_download_final");
    if (!finalAuth.ok) return finalAuth.response;
    const finalBooks = books ?? (useUserDefault ? await userReportBooks(finalAuth.username, tracking.bookmakerSlugs) : null);
    if (finalBooks) return selectedPdf(id, finalBooks, "final", true);
    try {
      return pdfResponse(fs.readFileSync(tracking.reportPath), `${tracking.id}.pdf`);
    } catch {
      return NextResponse.json({ error: "файл отчёта отсутствует на диске" }, { status: 404 });
    }
  }

  if (tracking.status === "TRACKING") {
    const liveAuth = await requirePerm(request, "reports_download_live_snapshot");
    if (!liveAuth.ok) return liveAuth.response;
    const liveBooks = books ?? (useUserDefault ? await userReportBooks(liveAuth.username, tracking.bookmakerSlugs) : null);
    if (liveBooks) return selectedPdf(id, liveBooks, "live", false);
    const result = spawnSync("npx", ["tsx", "generate-live-report.ts", id], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 45000,
    });
    if (result.status !== 0) {
      console.error(`[${id}] live-снимок отчёта не собрался:`, result.stdout, result.stderr);
      return NextResponse.json({ error: "не удалось собрать отчёт по текущим данным" }, { status: 500 });
    }
    const livePath = path.join(process.cwd(), "reports", `${id}.live.pdf`);
    try {
      return pdfResponse(fs.readFileSync(livePath), `${tracking.id}-live.pdf`);
    } catch {
      return NextResponse.json({ error: "не удалось прочитать сформированный отчёт" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "отчёт недоступен для этого статуса" }, { status: 404 });
}
