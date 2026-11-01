import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

interface ProcInfo {
  pid: number;
  ppid: number;
  cpu: number;
  rssKb: number;
  cmd: string;
}

// Читаем дерево процессов контейнера через `ps`
function readProcesses(): ProcInfo[] {
  const out = execSync("ps -eo pid,ppid,%cpu,rss,cmd --no-headers", {
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const result: ProcInfo[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    result.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      rssKb: Number(m[4]),
      cmd: m[5],
    });
  }
  return result;
}

function subtreeStats(all: ProcInfo[], rootPid: number) {
  const byPpid = new Map<number, ProcInfo[]>();
  for (const p of all) {
    if (!byPpid.has(p.ppid)) byPpid.set(p.ppid, []);
    byPpid.get(p.ppid)!.push(p);
  }
  const stack = [rootPid];
  const visited = new Set<number>();
  let cpu = 0;
  let rssKb = 0;
  let procCount = 0;
  let tabCount = 0;
  while (stack.length) {
    const pid = stack.pop()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    const proc = all.find((p) => p.pid === pid);
    if (proc) {
      cpu += proc.cpu;
      rssKb += proc.rssKb;
      procCount++;
      if (proc.cmd.includes("--type=renderer")) tabCount++;
    }
    for (const child of byPpid.get(pid) || []) stack.push(child.pid);
  }
  return { cpuPercent: Math.round(cpu * 10) / 10, memMb: Math.round(rssKb / 1024), procCount, tabCount };
}

const SYNC_FOOTBALL_PATTERN: Record<string, RegExp> = {
  booka: /\bnode\b.*sync-booka\.ts/,
  booke: /\bnode\b.*sync-booke\.ts/,
  bookb: /\bnode\b.*sync-bookb\.ts/,
  bookc: /\bnode\b.*sync-bookc\.ts/,
  bookf: /\bnode\b.*sync-bookf\.ts/,
  bookd: /\bnode\b.*sync-bookd\.ts/,
};
const SYNC_TENNIS_PATTERN: Record<string, RegExp> = {
  booka: /\bnode\b.*sync-booka-tennis\.ts/,
  booke: /\bnode\b.*sync-booke-tennis\.ts/,
  bookb: /\bnode\b.*sync-bookb-tennis\.ts/,
  bookc: /\bnode\b.*sync-bookc-tennis\.ts/,
  bookf: /\bnode\b.*sync-bookf-tennis\.ts/,
  bookd: /\bnode\b.*sync-bookd-tennis\.ts/,
};
// Хоккей - пока только 2 конторы готовы (см. sync-scheduler.sh)
const SYNC_HOCKEY_PATTERN: Record<string, RegExp> = {
  booka: /\bnode\b.*sync-booka-hockey\.ts/,
  booke: /\bnode\b.*sync-booke-hockey\.ts/,
  bookb: /\bnode\b.*sync-bookb-hockey\.ts/,
  bookc: /\bnode\b.*sync-bookc-hockey\.ts/,
  bookd: /\bnode\b.*sync-bookd-hockey\.ts/,
  bookf: /\bnode\b.*sync-bookf-hockey\.ts/,
};

type AggRow = { sport: string; cnt: number; last: Date };
let aggCache: { at: number; map: Map<string, AggRow[]> } | null = null;
async function aggregateByBookmaker(): Promise<Map<string, AggRow[]>> {
  if (aggCache && Date.now() - aggCache.at < 15_000) return aggCache.map;
  const rows = await prisma.$queryRaw<{ bid: string; sport: string; cnt: number; last: Date }[]>`
    SELECT bm."bookmakerId" AS bid, s.slug AS sport, count(*)::int AS cnt, max(bm."updatedAt") AS last
    FROM "BookmakerMatch" bm
    JOIN "Match" m ON m.id = bm."matchId"
    JOIN "League" l ON l.id = m."leagueId"
    JOIN "Sport" s ON s.id = l."sportId"
    GROUP BY bm."bookmakerId", s.slug`;
  const map = new Map<string, AggRow[]>();
  for (const r of rows) {
    const list = map.get(r.bid);
    const row = { sport: r.sport, cnt: r.cnt, last: r.last };
    if (list) list.push(row);
    else map.set(r.bid, [row]);
  }
  aggCache = { at: Date.now(), map };
  return map;
}

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "status_view");
  if (!auth.ok) return auth.response;
  // "Лог синхронизации" - отдельное право sync_view_logs, строже базового status_view
  const canViewLogs = auth.perms.sync_view_logs;

  const bookmakers = await prisma.bookmaker.findMany({ orderBy: { name: "asc" } });
  const sports = await prisma.sport.findMany();

  let allProcs: ProcInfo[] = [];
  try {
    allProcs = readProcesses();
  } catch {
    // ps недоступен/упал - просто не покажем процессы, остальное отдадим как есть
  }

  const agg = await aggregateByBookmaker();
  const stats = await Promise.all(
    bookmakers.map(async (b) => {
      const rows = agg.get(b.id) ?? [];
      const latestAt = rows.reduce<Date | null>((acc, r) => (!acc || r.last > acc ? r.last : acc), null);
      const latest = latestAt ? { updatedAt: latestAt } : null;
      const matchCount = rows.reduce((n, r) => n + r.cnt, 0);

      const bySport: Record<string, number> = {};
      for (const sport of sports) {
        bySport[sport.slug] = rows.find((r) => r.sport === sport.slug)?.cnt ?? 0;
      }

      const footballPattern = SYNC_FOOTBALL_PATTERN[b.slug];
      const tennisPattern = SYNC_TENNIS_PATTERN[b.slug];
      const hockeyPattern = SYNC_HOCKEY_PATTERN[b.slug];
      const footballRoot = footballPattern ? allProcs.find((p) => footballPattern.test(p.cmd)) : undefined;
      const tennisRoot = tennisPattern ? allProcs.find((p) => tennisPattern.test(p.cmd)) : undefined;
      const hockeyRoot = hockeyPattern ? allProcs.find((p) => hockeyPattern.test(p.cmd)) : undefined;

      let mode: string | null = null;
      let combined = { cpuPercent: 0, memMb: 0, procCount: 0, tabCount: 0 };
      let running = false;
      if (footballRoot) {
        running = true;
        mode = / top(\s|$)/.test(footballRoot.cmd) ? "футбол-топ" : "футбол-полный";
        const s = subtreeStats(allProcs, footballRoot.pid);
        combined = { ...s };
      }
      if (tennisRoot) {
        running = true;
        const s = subtreeStats(allProcs, tennisRoot.pid);
        mode = mode ? `${mode} + теннис` : "теннис";
        combined = {
          cpuPercent: Math.round((combined.cpuPercent + s.cpuPercent) * 10) / 10,
          memMb: combined.memMb + s.memMb,
          procCount: combined.procCount + s.procCount,
          tabCount: combined.tabCount + s.tabCount,
        };
      }
      if (hockeyRoot) {
        running = true;
        const s = subtreeStats(allProcs, hockeyRoot.pid);
        mode = mode ? `${mode} + хоккей` : "хоккей";
        combined = {
          cpuPercent: Math.round((combined.cpuPercent + s.cpuPercent) * 10) / 10,
          memMb: combined.memMb + s.memMb,
          procCount: combined.procCount + s.procCount,
          tabCount: combined.tabCount + s.tabCount,
        };
      }
      const procStatus = running
        ? { running: true, mode, ...combined }
        : { running: false, mode: null, cpuPercent: 0, memMb: 0, procCount: 0, tabCount: 0 };

      return {
        slug: b.slug,
        name: b.name,
        lastUpdatedAt: latest ? latest.updatedAt.toISOString() : null,
        matchCount,
        bySport,
        process: procStatus,
      };
    })
  );

  let log = "";
  try {
    const logPath = path.join(process.cwd(), "sync.log");
    const raw = fs.readFileSync(logPath, "utf-8");
    const lines = raw.split("\n");
    log = lines.slice(-400).join("\n");
  } catch {
    log = "Лог-файл sync.log ещё не создан — синхронизация ни разу не запускалась.";
  }

  let anomaliesLog = "";
  try {
    const anomaliesPath = path.join(process.cwd(), "anomalies.log");
    const raw = fs.readFileSync(anomaliesPath, "utf-8");
    const lines = raw.split("\n");
    anomaliesLog = lines.slice(-100).join("\n");
  } catch {
    anomaliesLog = "Проверка аномалий (ИИ) ещё не запускалась.";
  }

  return Response.json({
    bookmakers: stats,
    sports: sports.map((s) => s.slug),
    log: canViewLogs ? log : null,
    anomaliesLog: canViewLogs ? anomaliesLog : null,
    canViewLogs,
    serverTime: new Date().toISOString(),
  });
}
