import type { PrismaClient } from "@prisma/client";
// Свежесть данных конторы
export const STALE_BOOKMAKER_MS = 3 * 60 * 60 * 1000;
export const staleCutoff = () => new Date(Date.now() - STALE_BOOKMAKER_MS);

// : строка конторы считается свежей 3 часа (STALE_BOOKMAKER_MS), и когда сбор целой конторы встал
export const DEAD_BOOKMAKER_MS = 30 * 60 * 1000;
const deadCache = new Map<string, { at: number; ids: Set<string> }>();
// Последнее обновление каждой конторы по виду спорта
const lastCache = new Map<string, { at: number; rows: { bookmakerId: string; last: Date }[] }>();
const lastInflight = new Map<string, Promise<{ bookmakerId: string; last: Date }[]>>();
export async function lastUpdateByBookmaker(prisma: PrismaClient, sportSlug: string): Promise<{ bookmakerId: string; last: Date }[]> {
  const hit = lastCache.get(sportSlug);
  if (hit && Date.now() - hit.at < 30_000) return hit.rows;
  let job = lastInflight.get(sportSlug);
  if (!job) {
    job = prisma
      .$queryRaw<{ bookmakerId: string; last: Date }[]>`
        SELECT bm."bookmakerId", max(bm."updatedAt") AS last
        FROM "BookmakerMatch" bm
        JOIN "Match" m ON m.id = bm."matchId"
        JOIN "League" l ON l.id = m."leagueId"
        JOIN "Sport" s ON s.id = l."sportId"
        WHERE s.slug = ${sportSlug}
        GROUP BY bm."bookmakerId"`
      .then((rows) => {
        lastCache.set(sportSlug, { at: Date.now(), rows });
        return rows;
      })
      .finally(() => lastInflight.delete(sportSlug));
    lastInflight.set(sportSlug, job);
  }
  return job;
}

export async function deadBookmakerIds(prisma: PrismaClient, sportSlug: string): Promise<Set<string>> {
  const hit = deadCache.get(sportSlug);
  if (hit && Date.now() - hit.at < 30_000) return hit.ids;
  const rows = await lastUpdateByBookmaker(prisma, sportSlug);
  const ids = new Set(rows.filter((r) => Date.now() - r.last.getTime() > DEAD_BOOKMAKER_MS).map((r) => r.bookmakerId));
  deadCache.set(sportSlug, { at: Date.now(), ids });
  return ids;
}
