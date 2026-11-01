// Панель статуса Live-трекера (проект, "похожую панель сделай для лайва но чтобы их нельзя было спутать")
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { LIVE_ADAPTER_SLUGS, type LiveAdapterSlug } from "@/lib/liveAdapters";
import { requirePerm } from "@/lib/betmarkPerms";
import { CRYPTO_LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_DISPLAY, isCryptoLiveAdapterSlug } from "@/lib/liveAdapters";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

// Все 6 контор проекта, не только те, у кого уже есть live-адаптер
const ALL_BOOKMAKER_SLUGS = ["booka", "bookb", "bookc", "bookd", "booke", "bookf"] as const;
const ALL_BOOKMAKER_DISPLAY: Record<string, string> = {
  booka: "Book A",
  bookb: "Book B",
  bookc: "Book C",
  bookd: "Book D",
  booke: "Book E",
  bookf: "Book F",
};

function isLiveReady(slug: string): slug is LiveAdapterSlug {
  return (LIVE_ADAPTER_SLUGS as readonly string[]).includes(slug);
}

interface ProcInfo {
  pid: number;
  ppid: number;
  cpu: number;
  rssKb: number;
  cmd: string;
}

function readProcesses(): ProcInfo[] {
  const out = execSync("ps -eo pid,ppid,%cpu,rss,cmd --no-headers", { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 });
  const result: ProcInfo[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    result.push({ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), rssKb: Number(m[4]), cmd: m[5] });
  }
  return result;
}

function findLiveTrackerProc(all: ProcInfo[]): ProcInfo | null {
  return all.find((p) => /\bnode\b.*live-tracker-poll\.ts/.test(p.cmd)) ?? null;
}

// Панель опрашивает этот маршрут каждые 10 секунд
const CACHE_TTL_MS = 20_000;
let cache: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "live_view");
  if (!auth.ok) return auth.response;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return NextResponse.json(cache.body);
  const refresh = !inflight;
  if (refresh) {
    inflight = buildStatus()
      .then((body) => {
        cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
    inflight.catch(() => {});
  }
  // устаревший ответ отдаём сразу, пока обновление идёт в фоне: панель не ждёт семь секунд
  if (cache && inflight) return NextResponse.json(cache.body);
  return NextResponse.json(await inflight);
}

async function buildStatus() {
  let serviceActive = false;
  try {
    execSync("systemctl is-active odds-live-tracker.service", { encoding: "utf-8" });
    serviceActive = true;
  } catch {
    serviceActive = false;
  }

  let proc: { cpuPercent: number; memMb: number } | null = null;
  try {
    const all = readProcesses();
    const p = findLiveTrackerProc(all);
    if (p) proc = { cpuPercent: p.cpu, memMb: Math.round(p.rssKb / 1024) };
  } catch {
    // ps может быть недоступен в редких окружениях - не критично для остальной панели
  }

  const [scheduled, tracking, finished, failed] = await Promise.all([
    prisma.liveTracking.count({ where: { status: "SCHEDULED" } }),
    prisma.liveTracking.count({ where: { status: "TRACKING" } }),
    prisma.liveTracking.count({ where: { status: "FINISHED" } }),
    prisma.liveTracking.count({ where: { status: "FAILED" } }),
  ]);

  const bookmakerRows = await Promise.all(
    [...ALL_BOOKMAKER_SLUGS, ...CRYPTO_LIVE_ADAPTER_SLUGS].map(async (slug) => {
      const ready = isLiveReady(slug) || isCryptoLiveAdapterSlug(slug);
      if (!ready) {
        return {
          slug,
          name: ALL_BOOKMAKER_DISPLAY[slug] ?? slug,
          ready: false,
          trackedMatches: 0,
          totalEvents: 0,
          lastEventAt: null as string | null,
        };
      }
      const [trackedMatches, totalEvents, lastEvent] = await Promise.all([
        prisma.liveOddsEvent.findMany({ where: { bookmakerSlug: slug }, distinct: ["trackingId"], select: { trackingId: true } }),
        prisma.liveOddsEvent.count({ where: { bookmakerSlug: slug } }),
        prisma.liveOddsEvent.findFirst({ where: { bookmakerSlug: slug }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
      ]);
      return {
        slug,
        name: (CRYPTO_LIVE_ADAPTER_DISPLAY as Record<string, string>)[slug] ?? ALL_BOOKMAKER_DISPLAY[slug],
        ready: true,
        trackedMatches: trackedMatches.length,
        totalEvents,
        lastEventAt: lastEvent?.capturedAt.toISOString() ?? null,
      };
    })
  );

  return {
    serviceActive,
    proc,
    counts: { scheduled, tracking, finished, failed },
    bookmakers: bookmakerRows,
    serverTime: new Date().toISOString(),
  };
}
