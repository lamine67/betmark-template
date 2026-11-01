import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";

// Публичная сводка для обложки сколько будущих матчей сейчас сканируется у каждой конторы и когда линия обновлялась в
const url = process.env.DATABASE_URL || "";
const prisma = new PrismaClient({ datasources: { db: { url: url + (url.includes("?") ? "&" : "?") + "connection_limit=2" } } });

const FRESH_HOURS = 3;
const TTL_MS = 60 * 1000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return json(cache.body);

  const now = new Date();
  const fresh = new Date(Date.now() - FRESH_HOURS * 3600 * 1000);
  const rows = await prisma.bookmakerMatch.findMany({
    where: { match: { kickoffAt: { gte: now } }, updatedAt: { gte: fresh } },
    select: {
      matchId: true,
      updatedAt: true,
      bookmaker: { select: { slug: true } },
      match: { select: { league: { select: { sport: { select: { slug: true } } } } } },
    },
  });

  const by = new Map<string, { slug: string; matches: number; football: number; hockey: number; tennis: number; updatedAt: Date | null }>();
  const unique = new Set<string>();
  for (const r of rows) {
    // теннис на паузе на обложке считаем только футбол и хоккей, как и написано в тексте
    const sport = r.match.league.sport.slug;
    if (sport !== "football" && sport !== "hockey") continue;
    const slug = r.bookmaker.slug;
    let e = by.get(slug);
    if (!e) by.set(slug, (e = { slug, matches: 0, football: 0, hockey: 0, tennis: 0, updatedAt: null }));
    e.matches++;
    e[sport]++;
    if (!e.updatedAt || r.updatedAt > e.updatedAt) e.updatedAt = r.updatedAt;
    unique.add(r.matchId);
  }
  const bookmakers = [...by.values()].map((e) => ({ ...e, updatedAt: e.updatedAt ? e.updatedAt.toISOString() : null }));
  const body = { bookmakers, totals: { bookmakers: bookmakers.length, matches: unique.size } };
  cache = { at: Date.now(), body };
  return json(body);
}

function json(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=60" } });
}
