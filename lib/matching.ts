// Сведение одного и того же реального матча между разными БК
import { PrismaClient, MarketType } from "@prisma/client";
import { decideReversed, oddsFromList, NAME_SURE, NAME_MARGIN, type Odds } from "./orientation";
import { isCryptoSlug } from "./cryptoBooks";
import * as fuzzball from "fuzzball";

const TIME_WINDOW_MS = 35 * 60 * 1000;
const MATCH_THRESHOLD = 80;

const TEAM_ALIASES: Record<string, string> = {
  "пари сен-жермен": "псж",
  "пари сен жермен": "псж",
  "paris saint-germain": "псж",
  "paris sg": "псж",
  "psg": "псж",
};

// Экспортирован - тем же словарём пользуется и check-odds-anomalies.ts (pairScore) для своей независимой проверки
export function normalizeTeamForMatching(name: string): string {
  const key = name.trim().toLowerCase();
  return TEAM_ALIASES[key] ?? name;
}

const AGE_MARKER_RE = /\bu-?(1[0-9]|2[0-3])\b|до\s*(1[0-9]|2[0-3])\b/i;
const RESERVE_MARKER_RE = /(?:^|[\s-])(?:2|ii)$|резерв|молодёжк|(?:^|\s)мол\.?(?:\s|$)/i;

function extractAgeMarker(name: string): string | null {
  const m = name.match(AGE_MARKER_RE);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

const CONFUSABLE_BRANDS = new Set([
  "динамо", "спартак", "локомотив", "торпедо", "атлетико", "реал", "интер", "боруссия", "арсенал", "металлург",
  "шахтер", "шахтёр", "металлист", "црвена", "партизан", "славия", "левски", "цска", "сокол", "ротор", "витязь",
  "химик", "трактор", "заря", "звезда", "урал", "манчестер",
]);
const GENERIC_TOKENS = new Set(["фк", "хк", "ск", "клуб", "ф", "к", "fc", "hc", "sc", "ас", "ад"]);
function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (const ch of long) if (i < short.length && short[i] === ch) i++;
  return i === short.length;
}
function tokensCompatible(x: string, y: string): boolean {
  return x === y || isSubsequence(x, y) || isSubsequence(y, x) || fuzzball.ratio(x, y) >= 70;
}
export function qualifierConflict(a: string, b: string): boolean {
  // цифры/римские цифры/возрастные пометки/"мол" - не город и не бренд, ими занимается RESERVE_MARKER_RE/AGE_MARKER_RE
  const NOISE = /^(\d+|i{1,3}|iv|u-?\d+|мол|резерв)$/;
  const tok = (s: string) => s.toLowerCase().replace(/[().,]/g, " ").split(/\s+/).filter((t) => t && !GENERIC_TOKENS.has(t) && !NOISE.test(t));
  const ta = tok(a);
  const tb = tok(b);
  // Бренд - ПЕРВОЕ слово обеих строк ("Динамо", "Спартак", "Реал")
  if (ta.length < 2 || tb.length < 2 || ta[0] !== tb[0]) return false;
  // Только для брендов, которые носят РАЗНЫЕ клубы разных городов
  if (!CONFUSABLE_BRANDS.has(ta[0])) return false;
  const ra = ta.slice(1).filter((t) => !tb.includes(t));
  const rb = tb.slice(1).filter((t) => !ta.includes(t));
  if (!ra.length || !rb.length) return false; // одна строка - надмножество другой ("Динамо" vs "Динамо Москва")
  // Короткие остатки (<4 букв: "Мн", "НН", "КА", "АФК", "ДФ")
  if ([...ra, ...rb].some((t) => t.length < 4)) return false;
  const unexplainedA = ra.some((x) => !rb.some((y) => tokensCompatible(x, y)));
  const unexplainedB = rb.some((y) => !ra.some((x) => tokensCompatible(x, y)));
  return unexplainedA && unexplainedB;
}

export function hasConflictingMarker(a: string, b: string): boolean {
  const ageA = extractAgeMarker(a);
  const ageB = extractAgeMarker(b);
  if (ageA !== null || ageB !== null) {
    if (ageA !== ageB) return true;
  }
  const reserveA = RESERVE_MARKER_RE.test(a);
  const reserveB = RESERVE_MARKER_RE.test(b);
  if (reserveA !== reserveB) return true;
  if (qualifierConflict(a, b)) return true;
  return false;
}

export async function findOrCreateMatch(
  prisma: PrismaClient,
  params: {
    sportSlug: string;
    sportName: string;
    leagueName: string;
    homeTeam: string;
    awayTeam: string;
    kickoffAt: Date;
    bookmakerId: string;
    externalId: string;
    timeWindowMs?: number;
    // сырые кэфы конторы в её собственном порядке - для флип-теста, когда названия не решают ориентацию
    odds?: { outcome: string; price: number }[];
  }
): Promise<{ matchId: string; swapped: boolean }> {
  const {
    sportSlug,
    sportName,
    leagueName,
    homeTeam,
    awayTeam,
    kickoffAt,
    bookmakerId,
    externalId,
    timeWindowMs = TIME_WINDOW_MS,
    odds,
  } = params;

  const existing = await prisma.bookmakerMatch.findUnique({
    where: { bookmakerId_externalId: { bookmakerId, externalId } },
    select: { matchId: true, teamsSwapped: true, match: { select: { kickoffAt: true } } },
  });
  if (existing) {
    const drift = Math.abs(existing.match.kickoffAt.getTime() - kickoffAt.getTime());
    if (drift > 5 * 60 * 1000) {
      await prisma.match.update({ where: { id: existing.matchId }, data: { kickoffAt } });
    }
    return { matchId: existing.matchId, swapped: existing.teamsSwapped };
  }

  const sport = await prisma.sport.upsert({
    where: { slug: sportSlug },
    create: { slug: sportSlug, name: sportName },
    update: {},
  });

  // pg_advisory_xact_lock
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sportSlug}))`;

      const windowStart = new Date(kickoffAt.getTime() - timeWindowMs);
      const windowEnd = new Date(kickoffAt.getTime() + timeWindowMs);

      // Матч этой же конторы никогда не может "сойтись" сам с собой
      const candidates = await tx.match.findMany({
        where: {
          kickoffAt: { gte: windowStart, lte: windowEnd },
          league: { sportId: sport.id },
          bookmakerMatches: { none: { bookmakerId } },
        },
      });

      const homeTeamNorm = normalizeTeamForMatching(homeTeam);
      const awayTeamNorm = normalizeTeamForMatching(awayTeam);
      let best: { id: string; score: number; direct: number; swapped: number } | null = null;
      for (const c of candidates) {
        const cHomeNorm = normalizeTeamForMatching(c.homeTeam);
        const cAwayNorm = normalizeTeamForMatching(c.awayTeam);
        // Конфликтующая пометка
        const direct = hasConflictingMarker(homeTeamNorm, cHomeNorm) || hasConflictingMarker(awayTeamNorm, cAwayNorm)
          ? 0
          : Math.min(
              fuzzball.token_set_ratio(homeTeamNorm, cHomeNorm),
              fuzzball.token_set_ratio(awayTeamNorm, cAwayNorm)
            );
        const swapped = hasConflictingMarker(homeTeamNorm, cAwayNorm) || hasConflictingMarker(awayTeamNorm, cHomeNorm)
          ? 0
          : Math.min(
              fuzzball.token_set_ratio(homeTeamNorm, cAwayNorm),
              fuzzball.token_set_ratio(awayTeamNorm, cHomeNorm)
            );
        // ориентацию здесь не решаем
        const score = Math.max(direct, swapped);
        if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
          best = { id: c.id, score, direct, swapped };
        }
      }

      if (best) {
        // по названиям только при явном перевесе (>=80 и разница >=15)
        const own = oddsFromList(odds);
        const nameClear =
          (best.swapped >= NAME_SURE && best.swapped - best.direct >= NAME_MARGIN) ||
          (best.direct >= NAME_SURE && best.direct - best.swapped >= NAME_MARGIN);
        let others: Odds[] = [];
        if (!nameClear && own) {
          const snaps = await tx.oddsSnapshot.findMany({
            where: {
              bookmakerMatch: { matchId: best.id, bookmakerId: { not: bookmakerId } },
              market: { in: [MarketType.MATCH_WINNER_1X2, MarketType.MATCH_WINNER_2WAY] },
            },
            orderBy: { capturedAt: "desc" },
            select: { bookmakerMatchId: true, outcome: true, price: true, bookmakerMatch: { select: { bookmaker: { select: { slug: true } } } } },
          });
          const byRow = new Map<string, { crypto: boolean; o: Odds }>();
          for (const s of snaps) {
            const cur = byRow.get(s.bookmakerMatchId) ?? { crypto: isCryptoSlug(s.bookmakerMatch.bookmaker.slug), o: {} };
            const k = s.outcome as "1" | "X" | "2";
            if ((k === "1" || k === "X" || k === "2") && cur.o[k] === undefined) cur.o[k] = s.price;
            byRow.set(s.bookmakerMatchId, cur);
          }
          const all = [...byRow.values()];
          const regular = all.filter((r) => !r.crypto).map((r) => r.o);
          others = regular.length ? regular : all.map((r) => r.o);
        }
        return { matchId: best.id, swapped: decideReversed(best.direct, best.swapped, own, others) };
      }

      const leagueId = `${sportSlug}-league-${leagueName}`;
      const league = await tx.league.upsert({
        where: { id: leagueId },
        create: { id: leagueId, name: leagueName, sportId: sport.id },
        update: {},
      });

      const match = await tx.match.create({
        data: { homeTeam, awayTeam, kickoffAt, leagueId: league.id },
      });
      // Первая контора, заводящая карточку - задаёт канонический порядок хозяин/гость по определению
      return { matchId: match.id, swapped: false };
    },
    { timeout: 20000 }
  );
}
