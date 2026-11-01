// Общий PrismaClient для API сканера вилок (один на процесс Next, небольшой пул - см. урок про connection_limit)
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __forksPrisma?: PrismaClient };
const url = process.env.DATABASE_URL || "";
export const forksDb: PrismaClient =
  g.__forksPrisma ??
  new PrismaClient({ datasources: { db: { url: /connection_limit=/.test(url) ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=4" } } });
g.__forksPrisma = forksDb;

let namesCache: { at: number; data: Record<string, string> } | null = null;
export async function bookmakerNames(): Promise<Record<string, string>> {
  if (namesCache && Date.now() - namesCache.at < 10 * 60_000) return namesCache.data;
  const rows = await forksDb.bookmaker.findMany({ select: { slug: true, name: true } });
  const data = Object.fromEntries(rows.map((r) => [r.slug, r.name]));
  namesCache = { at: Date.now(), data };
  return data;
}
