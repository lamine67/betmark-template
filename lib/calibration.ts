import { PrismaClient } from "@prisma/client";
import * as fuzzball from "fuzzball";
import { explainClassification } from "./topLeagues";
import { extractBookbTarget, extractLeagueAndTeams } from "./calibrationAi";
import { verifyLeagueUrl as verifyBookdUrl } from "./collectors/bookd";
import { verifyLeagueUrl as verifyBookfUrl } from "./collectors/bookf";
import { verifyLeagueUrl as verifyBookcUrl } from "./collectors/bookc";
import { verifyLeagueTarget as verifyBookbTarget } from "./collectors/bookb";

export const URL_BOOKMAKERS = ["bookd", "bookf", "bookc"] as const;
export const PHOTO_AUTO_BOOKMAKER = "bookb";
export const PHOTO_FLAG_BOOKMAKERS = ["booka", "booke", "bookh", "bookg"] as const;
export const ALL_CALIBRATABLE_BOOKMAKERS = [
  ...URL_BOOKMAKERS,
  PHOTO_AUTO_BOOKMAKER,
  ...PHOTO_FLAG_BOOKMAKERS,
] as const;

export function calibrationKindFor(slug: string): "url" | "photo-auto" | "photo-flag" | null {
  if ((URL_BOOKMAKERS as readonly string[]).includes(slug)) return "url";
  if (slug === PHOTO_AUTO_BOOKMAKER) return "photo-auto";
  if ((PHOTO_FLAG_BOOKMAKERS as readonly string[]).includes(slug)) return "photo-flag";
  return null;
}

// Читается sync-bookd.ts/sync-bookf.ts/sync-bookc.ts
export async function getVerifiedUrls(prisma: PrismaClient, bookmakerSlug: string, sportSlug: string): Promise<string[]> {
  const rows = await prisma.calibrationSubmission.findMany({
    where: { bookmaker: { slug: bookmakerSlug }, sportSlug, kind: "url", status: "VERIFIED" },
    select: { url: true },
  });
  return rows.map((r) => r.url!).filter(Boolean);
}

// Читается sync-bookb.ts - формат TOP_LEAGUE_TARGETS ({country, league, label})
export async function getVerifiedBookbTargets(
  prisma: PrismaClient,
  sportSlug: string
): Promise<{ country: string; league: string; label: string }[]> {
  const rows = await prisma.calibrationSubmission.findMany({
    where: { bookmaker: { slug: "bookb" }, sportSlug, kind: "photo", status: "VERIFIED" },
    select: { extractedLeagueName: true, message: true },
  });
  // country хранится в message как "country|league" (см. verifySubmission ниже)
  return rows
    .map((r) => {
      const [country, league] = (r.message || "").split("|");
      if (!country || !league) return null;
      return { country, league, label: r.extractedLeagueName || league };
    })
    .filter((x): x is { country: string; league: string; label: string } => x !== null);
}

async function findMatchingBookmakerMatch(
  prisma: PrismaClient,
  bookmakerSlug: string,
  sportSlug: string,
  homeTeam: string,
  awayTeam: string
) {
  const candidates = await prisma.bookmakerMatch.findMany({
    where: {
      bookmaker: { slug: bookmakerSlug },
      match: { league: { sport: { slug: sportSlug } } },
    },
    include: { match: { include: { league: true } } },
    take: 5000, // защита от неограниченного запроса - на практике на порядок меньше
  });
  let best: { score: number; row: (typeof candidates)[number] } | null = null;
  for (const c of candidates) {
    const direct = Math.min(
      fuzzball.token_set_ratio(homeTeam, c.match.homeTeam),
      fuzzball.token_set_ratio(awayTeam, c.match.awayTeam)
    );
    const swapped = Math.min(
      fuzzball.token_set_ratio(homeTeam, c.match.awayTeam),
      fuzzball.token_set_ratio(awayTeam, c.match.homeTeam)
    );
    const score = Math.max(direct, swapped);
    if (score >= 80 && (!best || score > best.score)) best = { score, row: c };
  }
  return best?.row ?? null;
}

export async function verifySubmission(prisma: PrismaClient, submissionId: string): Promise<void> {
  const sub = await prisma.calibrationSubmission.findUnique({
    where: { id: submissionId },
    include: { bookmaker: true },
  });
  if (!sub) return;
  const slug = sub.bookmaker.slug;
  const kind = calibrationKindFor(slug);

  try {
    if (kind === "url") {
      if (!sub.url) throw new Error("нет ссылки");
      const verifyFn = slug === "bookd" ? verifyBookdUrl : slug === "bookf" ? verifyBookfUrl : verifyBookcUrl;
      const { leagueName, matchesFound } = await verifyFn(sub.url);
      await prisma.calibrationSubmission.update({
        where: { id: submissionId },
        data:
          matchesFound > 0
            ? {
                status: "VERIFIED",
                extractedLeagueName: leagueName,
                matchesFound,
                message: `Нашёл лигу «${leagueName}», ${matchesFound} матчей с реальными кэфами. Подключено к постоянному обходу.`,
                resolvedAt: new Date(),
              }
            : {
                status: "FAILED",
                extractedLeagueName: leagueName || null,
                matchesFound: 0,
                message: `Зашёл по ссылке, но не нашёл ни одного матча с правдоподобными кэфами. Проверьте, что ссылка ведёт именно на страницу лиги со списком матчей (не на аутрайты/статистику), и что на момент проверки в лиге вообще идут/предстоят матчи.`,
                resolvedAt: new Date(),
              },
      });
      return;
    }

    if (kind === "photo-auto") {
      // Book B
      if (!sub.photoPath) throw new Error("нет фото");
      const target = await extractBookbTarget(sub.photoPath);
      if (!target) {
        await prisma.calibrationSubmission.update({
          where: { id: submissionId },
          data: {
            status: "FAILED",
            message: "Не смог распознать на фото страну и лигу Book B - убедитесь, что на скриншоте видна страница bookb.ru с открытым сайдбаром или заголовком лиги.",
            resolvedAt: new Date(),
          },
        });
        return;
      }
      const { matchesFound } = await verifyBookbTarget(target.country, target.league);
      await prisma.calibrationSubmission.update({
        where: { id: submissionId },
        data:
          matchesFound > 0
            ? {
                status: "VERIFIED",
                extractedLeagueName: target.league,
                matchesFound,
                message: `${target.country}|${target.league}`, // см. getVerifiedBookbTargets - парсится обратно
                resolvedAt: new Date(),
              }
            : {
                status: "FAILED",
                extractedLeagueName: target.league,
                matchesFound: 0,
                message: `Распознал со скриншота "${target.country} → ${target.league}", но не смог найти/раскрыть такой пункт в сайдбаре Book B (проверено вживую сейчас) - либо распознавание неточное, либо на сайте в данный момент нет матчей этой лиги.`,
                resolvedAt: new Date(),
              },
      });
      return;
    }

    if (kind === "photo-flag") {
      if (!sub.photoPath) throw new Error("нет фото");
      const { leagueName, homeTeam, awayTeam } = await extractLeagueAndTeams(sub.photoPath);
      if (!homeTeam || !awayTeam) {
        await prisma.calibrationSubmission.update({
          where: { id: submissionId },
          data: {
            status: "FLAGGED",
            message: "Не смог распознать команды на фото - заявка всё равно отправлена, посмотрю скриншот сам.",
            resolvedAt: new Date(),
          },
        });
        return;
      }
      const found = await findMatchingBookmakerMatch(prisma, slug, sub.sportSlug, homeTeam, awayTeam);
      const message = found
        ? `Нашёл этот матч в уже собранных данных под лигой «${found.match.league.name}». ${explainClassification(found.match.league.name).summary}`
        : `Не нашёл такого матча ни в собранных данных ${sub.bookmaker.name} вообще - контора либо ещё не дошла до этой лиги в своём сборе, либо есть более глубокая проблема (например API-запрос вообще не охватывает эту категорию). Разберу отдельно.`;
      await prisma.calibrationSubmission.update({
        where: { id: submissionId },
        data: {
          status: "FLAGGED",
          extractedLeagueName: leagueName,
          extractedTeams: `${homeTeam} - ${awayTeam}`,
          message,
          resolvedAt: new Date(),
        },
      });
      return;
    }

    throw new Error(`неизвестная контора для калибровки: ${slug}`);
  } catch (e) {
    await prisma.calibrationSubmission.update({
      where: { id: submissionId },
      data: {
        status: kind === "photo-flag" ? "FLAGGED" : "FAILED",
        message: `Ошибка при проверке: ${(e as Error).message}`,
        resolvedAt: new Date(),
      },
    });
  }
}
