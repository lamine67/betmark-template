import { PrismaClient, MarketType } from "@prisma/client";
import { findOrCreateMatch } from "./matching";
import { recordOddsIfChanged } from "./oddsHistory";
import { thresholdFor, consensusGap, loadOtherRegularPrices, medianPrices } from "./consensusCheck";

// каждый процесс синка открывал пул Prisma по умолчанию (до ~9 подключений)
function syncPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL || "";
  const limited = /connection_limit=/.test(url) ? url : url + (url.includes("?") ? "&" : "?") + "connection_limit=3";
  return new PrismaClient({ datasources: { db: { url: limited } } });
}

const SPECIAL_EVENT_LEAGUE_RE = /специальн|кто забросит больше|сравнение команд/i;

const BOOKMAKER_NAMES: Record<string, string> = {
  booka: "Book A",
  booke: "Book E",
  booki: "Book I",
  bookj: "Book J",
  bookb: "Book B",
  bookc: "Book C",
  bookd: "Book D",
  bookf: "Book F",
  bookg: "Book G",
  bookh: "Book H",
  bookl: "Book L",
  bookk: "Book K", bookm: "Book M", booko: "Book O", bookn: "Book N", bookp: "Book P", books: "Book S", bookr: "Book R", booku: "Book U", bookt: "Book T", bookq: "Book Q",
};

interface Match1X2 {
  externalId: string;
  sourceUrl?: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  leagueName: string;
  odds: { outcome: string; price: number }[];
}

interface MatchTennis {
  externalId: string;
  player1: string;
  player2: string;
  kickoffAt: Date;
  tournamentName: string;
  odds: { outcome: string; price: number }[];
}

async function getBookmaker(prisma: PrismaClient, slug: string) {
  return prisma.bookmaker.upsert({
    where: { slug },
    update: {},
    create: { slug, name: BOOKMAKER_NAMES[slug] ?? slug },
  });
}

function swapOutcomeIfNeeded(outcome: string, swapped: boolean): string {
  if (!swapped) return outcome;
  if (outcome === "1") return "2";
  if (outcome === "2") return "1";
  return outcome;
}

// проверка по консенсусу (lib/consensusCheck.ts)
async function failsConsensus(
  prisma: PrismaClient,
  label: string,
  bookmakerSlug: string,
  bookmakerId: string,
  matchId: string,
  swapped: boolean,
  market: MarketType,
  outcomes: string[],
  m: { externalId: string; home: string; away: string; odds: { outcome: string; price: number }[] }
): Promise<boolean> {
  const own = outcomes.map((oc) => m.odds.find((o) => swapOutcomeIfNeeded(o.outcome, swapped) === oc)?.price ?? NaN);
  const others = await loadOtherRegularPrices(prisma, matchId, bookmakerId, market, outcomes);
  const gap = consensusGap(own, others.map((o) => o.prices));
  if (gap === null || gap < thresholdFor(bookmakerSlug)) return false;
  const med = medianPrices(own, others.map((o) => o.prices)) ?? [];
  console.warn(
    `[${label}] пропуск по консенсусу: ${m.externalId} ${m.home} — ${m.away}: свои ${own.join("/")}, ` +
      `медиана ${med.map((x) => +x.toFixed(2)).join("/")}, gap ${gap.toFixed(3)}, другие: ${others.map((o) => o.slug).join(",")}`
  );
  return true;
}

export async function runFootballOrHockeySync(opts: {
  label: string; // "booka" | "bookd:top" | "bookd-hockey" и т.п. - используется только в лог-строках
  bookmakerSlug: string;
  sportSlug: "football" | "hockey";
  sportName: string;
  timeWindowMs?: number;
  fetchMatches: () => Promise<Match1X2[]>;
  consensusCheck?: boolean; // по умолчанию ВКЛЮЧЕНО для всех контор (false - выключить)
}) {
  const prisma = syncPrisma();
  try {
    const bookmaker = await getBookmaker(prisma, opts.bookmakerSlug);
    const matches = await opts.fetchMatches();
    console.log(`[${opts.label}] собрано ${matches.length} матчей, записываю в БД...`);

    let written = 0;
    let skipped = 0; // пропущено по консенсусу
    for (const m of matches) {
      // ("дубликат, неправильные кэфы" на КХЛ): конторы отдают "спецставки" как отдельные события с командами реального
      if (SPECIAL_EVENT_LEAGUE_RE.test(m.leagueName)) continue;
      const { matchId, swapped } = await findOrCreateMatch(prisma, {
        sportSlug: opts.sportSlug,
        sportName: opts.sportName,
        leagueName: m.leagueName,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffAt: m.kickoffAt,
        bookmakerId: bookmaker.id,
        externalId: m.externalId,
        timeWindowMs: opts.timeWindowMs,
        odds: m.odds, // для флип-теста, когда названия не решают ориентацию
      });

      if (
        opts.consensusCheck !== false &&
        (await failsConsensus(prisma, opts.label, opts.bookmakerSlug, bookmaker.id, matchId, swapped, MarketType.MATCH_WINNER_1X2, ["1", "X", "2"], {
          externalId: m.externalId,
          home: m.homeTeam,
          away: m.awayTeam,
          odds: m.odds,
        }))
      ) {
        skipped++;
        continue;
      }

      const bm = await prisma.bookmakerMatch.upsert({
        where: { bookmakerId_externalId: { bookmakerId: bookmaker.id, externalId: m.externalId } },
        update: { rawHomeTeam: m.homeTeam, rawAwayTeam: m.awayTeam, matchId, sourceUrl: m.sourceUrl, teamsSwapped: swapped },
        create: {
          matchId,
          bookmakerId: bookmaker.id,
          externalId: m.externalId,
          rawHomeTeam: m.homeTeam,
          rawAwayTeam: m.awayTeam,
          sourceUrl: m.sourceUrl,
          teamsSwapped: swapped,
        },
      });

      for (const o of m.odds) {
        const outcome = swapOutcomeIfNeeded(o.outcome, swapped);
        await recordOddsIfChanged(prisma, bm.id, MarketType.MATCH_WINNER_1X2, outcome, o.price);
      }
      written++;
    }
    console.log(
      `[${opts.label}] записано ${written} матчей с коэффициентами.` +
        (opts.consensusCheck !== false ? ` пропущено по консенсусу ${skipped}` : "")
    );
  } finally {
    await prisma.$disconnect();
  }
}

export async function runTennisSync(opts: {
  label: string;
  bookmakerSlug: string;
  timeWindowMs?: number;
  fetchMatches: () => Promise<MatchTennis[]>;
  consensusCheck?: boolean; // по умолчанию ВКЛЮЧЕНО для всех контор (false - выключить)
}) {
  const prisma = syncPrisma();
  try {
    const bookmaker = await getBookmaker(prisma, opts.bookmakerSlug);
    const matches = await opts.fetchMatches();
    console.log(`[${opts.label}] собрано ${matches.length} матчей, записываю в БД...`);

    let written = 0;
    let skipped = 0; // пропущено по консенсусу
    for (const m of matches) {
      const { matchId, swapped } = await findOrCreateMatch(prisma, {
        sportSlug: "tennis",
        sportName: "Теннис",
        leagueName: m.tournamentName,
        homeTeam: m.player1,
        awayTeam: m.player2,
        kickoffAt: m.kickoffAt,
        bookmakerId: bookmaker.id,
        externalId: m.externalId,
        timeWindowMs: opts.timeWindowMs,
        odds: m.odds, // для флип-теста, когда названия не решают ориентацию
      });

      if (
        opts.consensusCheck !== false &&
        (await failsConsensus(prisma, opts.label, opts.bookmakerSlug, bookmaker.id, matchId, swapped, MarketType.MATCH_WINNER_2WAY, ["1", "2"], {
          externalId: m.externalId,
          home: m.player1,
          away: m.player2,
          odds: m.odds,
        }))
      ) {
        skipped++;
        continue;
      }

      const bm = await prisma.bookmakerMatch.upsert({
        where: { bookmakerId_externalId: { bookmakerId: bookmaker.id, externalId: m.externalId } },
        update: { rawHomeTeam: m.player1, rawAwayTeam: m.player2, matchId, teamsSwapped: swapped },
        create: {
          matchId,
          bookmakerId: bookmaker.id,
          externalId: m.externalId,
          rawHomeTeam: m.player1,
          rawAwayTeam: m.player2,
          teamsSwapped: swapped,
        },
      });

      for (const o of m.odds) {
        const outcome = swapOutcomeIfNeeded(o.outcome, swapped);
        await recordOddsIfChanged(prisma, bm.id, MarketType.MATCH_WINNER_2WAY, outcome, o.price);
      }
      written++;
    }
    console.log(
      `[${opts.label}] записано ${written} матчей с коэффициентами.` +
        (opts.consensusCheck !== false ? ` пропущено по консенсусу ${skipped}` : "")
    );
  } finally {
    await prisma.$disconnect();
  }
}
