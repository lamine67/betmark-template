// проверка цен Book D по консенсусу других контор
import { PrismaClient, MarketType } from "@prisma/client";
import { staleCutoff } from "./freshness";
import { isCryptoSlug } from "./cryptoBooks";

export const CONSENSUS_GAP_THRESHOLD = 0.09;
export const GENERAL_GAP_THRESHOLD = 0.12; // остальные конторы (см. thresholdFor)
export const MIN_OTHER_REGULAR_BOOKS = 2;

function validPrices(v: number[], len: number): boolean {
  return v.length === len && v.every((p) => Number.isFinite(p) && p > 1);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function normalize(prices: number[]): number[] {
  const p = prices.map((x) => 1 / x);
  const sum = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / sum);
}

// Медиана остальных контор по каждому исходу (null, если данных не хватает)
export function medianPrices(own: number[], others: number[][]): number[] | null {
  if (others.length < MIN_OTHER_REGULAR_BOOKS) return null;
  if (!validPrices(own, own.length) || own.length === 0) return null;
  if (!others.every((o) => validPrices(o, own.length))) return null;
  return own.map((_, i) => median(others.map((o) => o[i])));
}

export function consensusGap(own: number[], others: number[][]): number | null {
  const med = medianPrices(own, others);
  if (!med) return null;
  const qOwn = normalize(own);
  const qMed = normalize(med);
  return Math.max(...qOwn.map((q, i) => Math.abs(q - qMed[i])));
}

// Порог по конторе замер по ~14 000 живых строк прематча
export function thresholdFor(bookmakerSlug: string): number {
  return bookmakerSlug === "bookd" ? CONSENSUS_GAP_THRESHOLD : GENERAL_GAP_THRESHOLD;
}

// Только чтение
export async function loadOtherRegularPrices(
  prisma: PrismaClient,
  matchId: string,
  excludeBookmakerId: string,
  market: MarketType,
  outcomes: string[]
): Promise<{ slug: string; prices: number[] }[]> {
  const rows = await prisma.bookmakerMatch.findMany({
    where: { matchId, bookmakerId: { not: excludeBookmakerId }, updatedAt: { gte: staleCutoff() } },
    include: { bookmaker: { select: { slug: true } } },
  });
  const regular = rows.filter((r) => !isCryptoSlug(r.bookmaker.slug));
  if (!regular.length) return [];
  const snaps = await prisma.$queryRaw<{ bookmakerMatchId: string; outcome: string; price: number }[]>`
    SELECT DISTINCT ON ("bookmakerMatchId", outcome) "bookmakerMatchId", outcome, price
    FROM "OddsSnapshot"
    WHERE "bookmakerMatchId" = ANY(${regular.map((r) => r.id)}) AND market = ${market}::"MarketType"
    ORDER BY "bookmakerMatchId", outcome, "capturedAt" DESC`;
  const by = new Map<string, Record<string, number>>();
  for (const s of snaps) {
    const o = by.get(s.bookmakerMatchId) ?? {};
    o[s.outcome] = s.price;
    by.set(s.bookmakerMatchId, o);
  }
  const result: { slug: string; prices: number[] }[] = [];
  for (const r of regular) {
    const o = by.get(r.id);
    if (!o) continue;
    const prices = outcomes.map((oc) => o[oc]);
    if (prices.every((x) => typeof x === "number")) result.push({ slug: r.bookmaker.slug, prices });
  }
  return result;
}
