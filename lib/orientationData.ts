// общая загрузка для audit-orientation.ts и repair-teams-swapped.ts
import { PrismaClient } from "@prisma/client";
import { isCryptoSlug } from "./cryptoBooks";
import { staleCutoff } from "./freshness";
import { consensus, flipTestDetails, type Odds, type Probs } from "./orientation";

export interface RowCheck {
  bmId: string;
  slug: string;
  matchId: string;
  card: string;
  raw: string;
  sport: string;
  teamsSwapped: boolean;
  fresh: boolean;
  odds: Odds | null;
  cons: Probs | null;
  consBooks: number; // сколько других обычных контор вошло в консенсус
  d: number | null;
  f: number | null;
  reversed: boolean;
}

export async function loadRowChecks(prisma: PrismaClient): Promise<RowCheck[]> {
  const cutoff = staleCutoff();
  const ms = await prisma.match.findMany({
    where: { kickoffAt: { gt: new Date() } },
    include: { league: { include: { sport: true } }, bookmakerMatches: { include: { bookmaker: true } } },
  });
  const ids = ms.flatMap((m) => m.bookmakerMatches.map((b) => b.id));
  const rows: { bookmakerMatchId: string; outcome: string; price: number }[] = ids.length
    ? await prisma.$queryRaw`SELECT DISTINCT ON ("bookmakerMatchId", outcome) "bookmakerMatchId", outcome, price FROM "OddsSnapshot" WHERE "bookmakerMatchId" = ANY(${ids}) AND market = 'MATCH_WINNER_1X2' ORDER BY "bookmakerMatchId", outcome, "capturedAt" DESC`
    : [];
  const odds = new Map<string, Odds>();
  for (const r of rows) {
    if (r.outcome !== "1" && r.outcome !== "X" && r.outcome !== "2") continue;
    const o = odds.get(r.bookmakerMatchId) ?? {};
    o[r.outcome] = r.price;
    odds.set(r.bookmakerMatchId, o);
  }
  const out: RowCheck[] = [];
  for (const m of ms) {
    for (const bm of m.bookmakerMatches) {
      const fresh = bm.updatedAt >= cutoff;
      const own = odds.get(bm.id) ?? null;
      const others = m.bookmakerMatches
        .filter((x) => x.id !== bm.id && x.bookmakerId !== bm.bookmakerId && !isCryptoSlug(x.bookmaker.slug) && x.updatedAt >= cutoff)
        .map((x) => odds.get(x.id))
        .filter((o): o is Odds => !!o && o["1"] !== undefined && o["2"] !== undefined);
      const cons = others.length >= 2 ? consensus(others) : null;
      const det = fresh && own ? flipTestDetails(own, cons) : null;
      out.push({
        bmId: bm.id,
        slug: bm.bookmaker.slug,
        matchId: m.id,
        card: `${m.homeTeam} - ${m.awayTeam} @${m.kickoffAt.toISOString().slice(5, 16)}`,
        raw: `${bm.rawHomeTeam} - ${bm.rawAwayTeam}`,
        sport: m.league.sport.slug,
        teamsSwapped: bm.teamsSwapped,
        fresh,
        odds: own,
        cons,
        consBooks: others.length,
        d: det?.d ?? null,
        f: det?.f ?? null,
        reversed: det?.reversed ?? false,
      });
    }
  }
  return out;
}

export const GUARD_ROWS: [string, string][] = [
  ["bookn", "Вуковар"], ["booke", "Вуковар"], ["bookf", "Вуковар"],
  ["bookh", "Жилина"], ["bookg", "Жилина"],
  ["bookf", "Марсашлокк"],
];

export const KNOWN_FALSE_ROWS: [string, ...string[]][] = [
  ["bookn", "Ислочь"], ["bookn", "Манчестер Сити", "АЕК"], ["bookn", "Баник Острава 2"],
  ["bookn", "Серро"], ["bookn", "Косово"],
  ["bookq", "Манчестер Сити", "АЕК"],
  ["booke", "Бней Ядида"],
  ["booki", "Рияд"],
  ["bookg", "Сидней"],
];

export const fmtOdds = (o: Odds | null) => (o ? `${o["1"] ?? "-"}/${o.X ?? "-"}/${o["2"] ?? "-"}` : "нет");
export const fmtProbs = (p: Probs | null) => (p ? `${(p["1"] ?? 0).toFixed(3)}/${(p.X ?? 0).toFixed(3)}/${(p["2"] ?? 0).toFixed(3)}` : "нет");
// Все подстроки должны входить в название карточки (регистр не важен)
export const hits = (r: RowCheck, [slug, ...subs]: [string, ...string[]]) =>
  r.slug === slug && subs.every((sub) => r.card.toLowerCase().includes(sub.toLowerCase()));
