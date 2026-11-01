// Скачивание прематч-отчёта по матчу PDF собирается по запросу тем же генератором
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { requirePerm } from "@/lib/betmarkPerms";
import { buildPrematchPayload, PrematchReportError, PREMATCH_BOOK_ORDER } from "@/lib/prematchReport";

const g = globalThis as unknown as { __prematchPrisma?: PrismaClient };
const prisma = g.__prematchPrisma ?? new PrismaClient();
g.__prematchPrisma = prisma;

export const dynamic = "force-dynamic";
const run = promisify(execFile);
const FRESH_MS = 60_000;

const clean = (v: unknown): string[] => (Array.isArray(v) ? PREMATCH_BOOK_ORDER.filter((s) => v.includes(s)) : []);

export async function GET(request: NextRequest, { params }: { params: Promise<{ matchId: string }> }) {
  const auth = await requirePerm(request, "reports_download_final");
  if (!auth.ok) return auth.response;
  const { matchId } = await params;
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(matchId)) return NextResponse.json({ error: "неверный матч" }, { status: 400 });

  const booksParam = request.nextUrl.searchParams.get("books");
  let books: string[] | null;
  if (booksParam === "all") books = null;
  else if (booksParam) books = clean(booksParam.split(","));
  else {
    const row = await prisma.userSetting.findUnique({ where: { username: auth.username } });
    books = clean((row?.livePrefs as { prematchBooks?: unknown } | null)?.prematchBooks);
  }
  if (books && books.length === 0) books = null;
  const key = crypto.createHash("sha1").update(books ? [...books].sort().join(",") : "all").digest("hex").slice(0, 12);

  const dir = path.join(process.cwd(), "reports");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `prematch-${matchId}.${key}.pdf`);
  const send = (buf: Buffer) =>
    new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="prematch-${matchId.slice(0, 8)}.pdf"` },
    });

  try {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { kickoffAt: true } });
    if (!match) return NextResponse.json({ error: "матч не найден" }, { status: 404 });
    if (fs.existsSync(file)) {
      const mt = fs.statSync(file).mtimeMs;
      // файл после начала матча - окончательный; до начала годен минуту
      if (mt >= match.kickoffAt.getTime() || Date.now() - mt < FRESH_MS) return send(fs.readFileSync(file));
    }
    const payload = await buildPrematchPayload(prisma, matchId, books);
    const tmpJson = path.join(os.tmpdir(), `prematch-${crypto.randomBytes(6).toString("hex")}.json`);
    const tmpPdf = tmpJson.replace(/\.json$/, ".pdf");
    fs.writeFileSync(tmpJson, JSON.stringify(payload), "utf-8");
    try {
      await run("python3", ["generate_live_report.py", tmpJson, tmpPdf], { cwd: process.cwd(), timeout: 120_000 });
      fs.copyFileSync(tmpPdf, file);
      return send(fs.readFileSync(tmpPdf));
    } finally {
      for (const f of [tmpJson, tmpPdf]) {
        try {
          fs.unlinkSync(f);
        } catch {
          /* файла нет - нормально */
        }
      }
    }
  } catch (e) {
    if (e instanceof PrematchReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[prematch-report ${matchId}]`, (e as Error).message);
    return NextResponse.json({ error: "не удалось собрать отчёт" }, { status: 500 });
  }
}
