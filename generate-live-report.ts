// Мост Node -> Python для отчёта Live-трекера (проект)
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_DISPLAY, LIVE_DETAIL_LEVEL_CONFIG, type LiveDetailLevel } from "./lib/liveAdapters";

const prisma = new PrismaClient();

// ключ набора контор - одинаковая формула здесь и в app/api/live-tracking/[id]/report/route.ts
const subsetKey = (slugs: string[]) => createHash("sha1").update([...slugs].sort().join(",")).digest("hex").slice(0, 12);
// личные наборы контор аккаунтов при завершении матча заранее готовим каждый различный набор, НО только у тех
async function userReportSets(): Promise<string[][]> {
  try {
    const rows = await prisma.userSetting.findMany({ select: { livePrefs: true } });
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const row of rows) {
      const lp = row.livePrefs as { reportBooks?: unknown; reportPrepare?: unknown } | null;
      if (lp?.reportPrepare !== true) continue; // ответил «часто меняю» или не отвечал - заранее не готовим
      const v = lp?.reportBooks;
      if (!Array.isArray(v)) continue;
      const set = v.filter((x: unknown): x is string => typeof x === "string" && /^[a-z0-9]+$/.test(x));
      const key = [...set].sort().join(",");
      if (set.length > 0 && !seen.has(key)) {
        seen.add(key);
        out.push(set);
      }
    }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}

const BOOKMAKER_DISPLAY: Record<string, string> = {
  booka: "Book A",
  bookb: "Book B",
  bookc: "Book C",
  booke: "Book E",
  bookf: "Book F",
  bookd: "Book D",
  bookg: "Book G",
  bookh: "Book H",
  booki: "Book I",
  bookj: "Book J",
  ...CRYPTO_LIVE_ADAPTER_DISPLAY,
};
const BOOKMAKER_ORDER: string[] = [...LIVE_ADAPTER_SLUGS, ...CRYPTO_LIVE_ADAPTER_SLUGS];

const SPORT_DISPLAY: Record<string, string> = {
  football: "Футбол",
  hockey: "Хоккей",
  tennis: "Теннис",
};

function fmtMsk(d: Date): string {
  // Сервер работает в UTC (см. остальные sync-скрипты/логи проекта)
  const msk = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()} ${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())} (МСК)`;
}

function fmtTimeMsk(d: Date): string {
  const msk = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}:${pad(msk.getUTCSeconds())}`;
}

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || "https://example.com";
const AI_MODEL = process.env.AI_MODEL || "gemini-flash-lite-latest";
// отчёт по выбранным конторам (argv[3]) собирается по запросу на скачивание и ждёт его в браузере
const AI_TIMEOUT_MS = process.argv[3] ? 90_000 : 180_000;

interface AiFinalReview {
  summary: string;
  anomalies: { time: string; bookmaker: string; reason: string }[];
}

async function runAiFinalReview(
  matchInfo: { home: string; away: string; league: string; sport: string; score: string },
  moments: { time: string; isGoal: boolean; goalTeam: string | null; matchMinute: number | null; scoreHome: number | null; scoreAway: number | null; prices: Record<string, { "1": number; X: number | null; "2": number } | null> }[]
): Promise<AiFinalReview | null> {
  if (!AI_API_KEY || moments.length === 0) return null;
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${AI_API_KEY}` },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        enable_thinking: false,
        messages: [
          {
            role: "system",
            content:
              "Ты помогаешь собрать финальный отчёт по live-коэффициентам одного спортивного матча для сайта-" +
              "агрегатора букмекерских контор. На входе - полная хронология матча: массив моментов, у каждого " +
              "время (МСК), счёт на тот момент, был ли гол, и коэффициенты (П1/X/П2, X может быть null для " +
              "видов спорта без ничьей) у нескольких контор на этот момент. У ТЕБЯ ДВЕ ЗАДАЧИ. " +
              "ЗАДАЧА 1 - краткое резюме матча на русском (2-4 предложения): счёт, ключевые голы (кто забил, " +
              "на какой минуте, если видно по данным), как менялись коэффициенты по ходу игры (например явный " +
              "фаворит с самого начала, или матч был равным судя по кэфам, или коэффициенты сильно скакали). " +
              "Пиши нейтрально и по делу, как спортивный дайджест, не выдумывай факты, которых нет в данных " +
              "(имена игроков, причины голов и т.п. - этого в данных нет, не придумывай). " +
              "ЗАДАЧА 2 - найти АНОМАЛИИ: конкретные значения кэфа, которые выглядят как ОШИБКА СБОРА ДАННЫХ " +
              "(не настоящая цена букмекера), а не как обычное движение линии. Примеры настоящих аномалий: " +
              "явно нереалистичное значение (например 500.00 или 0.01 на обычный исход в командном виде " +
              "спорта), одно значение резко выбивается на ОДИН момент и тут же возвращается к прежнему уровню " +
              "у той же конторы без гола/события-причины (похоже на глюк парсинга, а не на реальное движение " +
              "рынка), сумма implied-вероятностей по трём исходам совершенно абсурдна (совокупный payout " +
              "сильно ниже 50% или сильно выше 150%). ВАЖНО - если одна и та же неправдоподобная цена у ОДНОЙ " +
              "конторы повторяется НЕСКОЛЬКО моментов подряд (застряла на нереальном значении, а не вернулась к " +
              "норме сразу) - это ВСЁ РАВНО аномалия, включи В КАЖДЫЙ такой момент ОТДЕЛЬНОЙ записью в " +
              "anomalies (не только первый момент, где она появилась) - иначе часть брака останется видна в " +
              "отчёте. НЕ считай аномалией: обычное расхождение цены между " +
              "разными конторами (это нормально, разные конторы всегда котируют чуть по-разному); резкий скачок " +
              "СРАЗУ после гола (это ожидаемо и правильно); контору, у которой стоит прочерк/null (это уже " +
              "обработано отдельным механизмом, не твоя забота); постепенный тренд цены в одну сторону в " +
              "течение матча. Если сомневаешься - НЕ включай в anomalies, лучше пропустить настоящую ошибку, " +
              "чем ошибочно вычеркнуть настоящую цену букмекера. Верни ТОЛЬКО JSON вида " +
              '{"summary": "...", "anomalies": [{"time": "17:23:11", "bookmaker": "Book G", "reason": "..."}]}' +
              " - поле time должно ТОЧНО совпадать со значением time из входного массива moments, bookmaker - " +
              "точное название конторы как в ключах prices. Если аномалий нет - верни пустой массив.",
          },
          { role: "user", content: JSON.stringify({ match: matchInfo, moments }) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("пустой content в ответе");
    const parsed = JSON.parse(text);
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.anomalies)) throw new Error("неожиданный формат ответа ИИ");
    return parsed;
  } catch (e) {
    console.error(`финальная ИИ-проверка отчёта упала (отчёт всё равно будет собран, просто без резюме/доп.проверки):`, (e as Error).message);
    return null;
  }
}

async function main() {
  const trackingId = process.argv[2];
  const onlyBooks = process.argv[3] ? process.argv[3].split(",").filter((s) => /^[a-z0-9]+$/.test(s)) : null;
  const fileToken = /^[a-f0-9]{8,32}$/.test(process.argv[4] ?? "") ? process.argv[4] : null;
  if (onlyBooks && !fileToken) {
    console.error("для отчёта по выбранным конторам нужен токен файла (argv[4])");
    process.exit(1);
  }
  if (!trackingId) {
    console.error("usage: generate-live-report.ts <trackingId> [slug,slug token]");
    process.exit(1);
  }

  const tracking = await prisma.liveTracking.findUnique({
    where: { id: trackingId },
    include: { match: { include: { league: { include: { sport: true } } } } },
  });
  if (!tracking) {
    console.error(`[${trackingId}] LiveTracking не найден`);
    process.exit(1);
  }
  // Узкий тип tracking (не | null) не сохраняется TS-компилятором внутри вложенных function-деклараций ниже
  const trk = tracking;
  const isTennis = tracking.match.league.sport.slug === "tennis"; // теннис сеты вместо голов, два исхода, без ИИ-резюме
  const live = tracking.status === "TRACKING";
  if (!live && tracking.status !== "FINISHED") {
    console.error(`[${trackingId}] статус ${tracking.status}, отчёт возможен только для TRACKING/FINISHED - пропускаю генерацию`);
    process.exit(1);
  }

  const events = await prisma.liveOddsEvent.findMany({
    where: { trackingId },
    orderBy: { capturedAt: "asc" },
  });
  if (events.length === 0) {
    console.error(`[${trackingId}] нет ни одной записи LiveOddsEvent - отчёт строить не из чего`);
    process.exit(1);
  }

  const bookmakerSlugs = BOOKMAKER_ORDER.filter((slug) => events.some((e) => e.bookmakerSlug === slug));
  // В колонки отчёта попадают только выбранные конторы
  const reportSlugs = onlyBooks ? bookmakerSlugs.filter((slug) => onlyBooks.includes(slug)) : bookmakerSlugs;
  if (reportSlugs.length === 0) {
    console.error(`[${trackingId}] среди выбранных контор нет ни одной с данными в этом отслеживании`);
    process.exit(1);
  }
  const bookmakers = reportSlugs.map((slug) => BOOKMAKER_DISPLAY[slug] ?? slug);

  const byTime = new Map<number, typeof events>();
  for (const e of events) {
    const t = e.capturedAt.getTime();
    if (!byTime.has(t)) byTime.set(t, []);
    byTime.get(t)!.push(e);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);

  const latest: Record<string, { "1": number; X: number | null; "2": number } | null> = {};
  const wentUnavailable = new Set<string>();
  const moments = times.map((t) => {
    const rows = byTime.get(t)!;
    for (const r of rows) {
      if (r.unavailable) {
        latest[r.bookmakerSlug] = null;
        wentUnavailable.add(r.bookmakerSlug);
      } else {
        latest[r.bookmakerSlug] = { "1": r.price1, X: r.priceX, "2": r.price2 };
        wentUnavailable.delete(r.bookmakerSlug);
      }
    }
    const goalRow = rows.find((r) => r.isGoal);
    const prices: Record<string, { "1": number; X: number | null; "2": number } | null> = {};
    const unavailableNow: string[] = [];
    for (const slug of bookmakerSlugs) {
      const name = BOOKMAKER_DISPLAY[slug] ?? slug;
      prices[name] = latest[slug] ?? null;
      if (wentUnavailable.has(slug)) unavailableNow.push(name);
    }
    return {
      time: fmtTimeMsk(new Date(t)),
      isGoal: !!goalRow,
      goalTeam: goalRow?.goalTeam === "home" ? tracking.match.homeTeam : goalRow?.goalTeam === "away" ? tracking.match.awayTeam : null,
      matchMinute: rows[0].matchMinute,
      scoreDetail: rows[0].scoreDetail ?? null, // теннис: геймы по сетам и очки гейма
      scoreHome: rows[0].scoreHome,
      scoreAway: rows[0].scoreAway,
      prices,
      unavailableNow,
    };
  });

  if (moments.length > 0) {
    const startPrices = moments[0].prices;
    const missingSlugs = bookmakerSlugs.filter((slug) => startPrices[BOOKMAKER_DISPLAY[slug] ?? slug] == null);
    if (missingSlugs.length > 0) {
      const bmsWithPrematch = await prisma.bookmakerMatch.findMany({
        where: { matchId: tracking.matchId, bookmaker: { slug: { in: missingSlugs } } },
        include: {
          bookmaker: true,
          oddsSnapshots: {
            where: { capturedAt: { lte: tracking.match.kickoffAt } },
            orderBy: { capturedAt: "desc" },
            take: 12, // с запасом на все исходы (1/X/2), даже если писались не одним батчем
          },
        },
      });
      for (const bm of bmsWithPrematch) {
        const bySnap = new Map<string, number>();
        for (const s of bm.oddsSnapshots) {
          if (!bySnap.has(s.outcome)) bySnap.set(s.outcome, s.price); // первая (самая свежая) запись на исход
        }
        const price1 = bySnap.get("1");
        const price2 = bySnap.get("2");
        if (price1 == null || price2 == null) continue; // недостаточно данных для полноценной тройки
        startPrices[BOOKMAKER_DISPLAY[bm.bookmaker.slug] ?? bm.bookmaker.slug] = {
          "1": price1,
          X: bySnap.get("X") ?? null,
          "2": price2,
        };
      }
    }
  }

  const LATE_JOIN_THRESHOLD_MS = 3 * 60 * 1000;
  const startedAtMs = tracking.startedAt?.getTime();
  const startedLate = startedAtMs != null && startedAtMs - tracking.match.kickoffAt.getTime() > LATE_JOIN_THRESHOLD_MS;
  let startedLateNote: string | null = null;
  if (startedLate) {
    const minutesLate = Math.round((startedAtMs! - tracking.match.kickoffAt.getTime()) / 60000);
    const first = moments[0];
    startedLateNote =
      `Отчёт покрывает НЕ весь матч с начала - отслеживание стартовало примерно через ${minutesLate} мин. после кикоффа ` +
      (first.matchMinute != null ? `(на тот момент шла ${first.matchMinute}-я минута, ` : `(`) +
      (isTennis
        ? `счёт по сетам был ${first.scoreHome}:${first.scoreAway}${first.scoreDetail ? ` (${first.scoreDetail})` : ""}). Коэффициенты и сеты до этого момента в отчёте отсутствуют.`
        : `счёт был ${first.scoreHome}:${first.scoreAway}). Коэффициенты и голы до этого момента в отчёте отсутствуют.`);
  }

  const aiCachePath = path.join(__dirname, "reports", `${trackingId}.ai.json`);
  let aiReview: AiFinalReview | null = null;
  // тенниса ИИ-проверка не касается: её подсказка написана про голы и ничью; отчёт по теннису - только цифры
  if (!live && !isTennis) {
    let cached: (AiFinalReview & { none?: boolean }) | null = null;
    try {
      const raw = JSON.parse(readFileSync(aiCachePath, "utf-8"));
      const fresh = !raw?.none || Date.now() - statSync(aiCachePath).mtimeMs < 30 * 60 * 1000;
      if (fresh) cached = raw;
    } catch {
      cached = null;
    }
    if (cached) {
      aiReview = cached.none ? null : cached;
    } else {
      aiReview = await runAiFinalReview(
        {
          home: tracking.match.homeTeam,
          away: tracking.match.awayTeam,
          league: tracking.match.league.name,
          sport: tracking.match.league.sport.slug,
          score: `${tracking.scoreHome ?? 0} : ${tracking.scoreAway ?? 0}`,
        },
        moments
      );
      try {
        mkdirSync(path.dirname(aiCachePath), { recursive: true });
        writeFileSync(aiCachePath, JSON.stringify(aiReview ?? { none: true }), "utf-8");
      } catch {
        /* кэш не критичен */
      }
    }
  }
  const rawMoments = !live && tracking.detailLevel === "ULTRA" ? structuredClone(moments) : null;

  let aiSummary: string | null = null;
  if (aiReview) {
    aiSummary = aiReview.summary;
    // живой тест показал: одна и та же неправдоподобная цена у конторы часто держится НЕСКОЛЬКО моментов подряд
    const isClose = (x: number, y: number) => Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * 0.3;
    for (const a of aiReview.anomalies) {
      const idx = moments.findIndex((m) => m.time === a.time);
      if (idx === -1) continue;
      const moment = moments[idx];
      if (!(a.bookmaker in moment.prices)) continue;
      const badPrice = moment.prices[a.bookmaker];
      moment.prices[a.bookmaker] = null;
      console.error(`[${trackingId}] ИИ исключил аномалию из отчёта: ${a.time} ${a.bookmaker} - ${a.reason}`);

      if (badPrice && !(aiReview as unknown as { exact?: boolean }).exact) {
        for (const dir of [-1, 1] as const) {
          let i = idx + dir;
          while (i >= 0 && i < moments.length) {
            const p = moments[i].prices[a.bookmaker];
            if (!p) break;
            const same =
              isClose(p["1"], badPrice["1"]) &&
              isClose(p["2"], badPrice["2"]) &&
              (badPrice.X == null || p.X == null || isClose(p.X, badPrice.X));
            if (!same) break;
            moments[i].prices[a.bookmaker] = null;
            console.error(`[${trackingId}] ИИ-аномалия расширена на соседний момент: ${moments[i].time} ${a.bookmaker} (то же плохое значение)`);
            i += dir;
          }
        }
      }
    }
  }

  function buildPayload(momentsArg: typeof moments, aiSummaryArg: string | null, subset: string[] | null) {
    return {
      trackingId,
      match: {
        home: trk.match.homeTeam,
        away: trk.match.awayTeam,
        sport: SPORT_DISPLAY[trk.match.league.sport.slug] ?? trk.match.league.sport.name,
        league: trk.match.league.name,
        kickoff: fmtMsk(trk.match.kickoffAt),
        // Live-снимок (матч ещё идёт) - нет endedAt/endReason, ещё не факт, что счёт финальный
        trackingEnd: live ? `матч ещё идёт (снимок на ${fmtMsk(new Date())})` : trk.endedAt ? fmtMsk(trk.endedAt) : "—",
        endReason: live ? "матч продолжается" : trk.endReason ?? "—",
        score: `${trk.scoreHome ?? 0} : ${trk.scoreAway ?? 0}${isTennis && trk.scoreDetail ? ` (${trk.scoreDetail.split(" · ")[0]})` : ""}`,
        tennis: isTennis,
        interval: (() => {
          const cfg = LIVE_DETAIL_LEVEL_CONFIG[trk.detailLevel as LiveDetailLevel];
          return cfg ? `каждые ~${cfg.pollIntervalSec} сек (${cfg.label.toLowerCase()})` : "каждые ~10 сек";
        })(),
        live,
        startedLate,
        startedLateNote,
        aiSummary: aiSummaryArg,
        // Плашка на "сыром" (без ИИ) варианте отчёта - см. rawMoments выше
        rawVariantNote: rawMoments != null && aiSummaryArg == null
          ? "Это версия отчёта БЕЗ финальной проверки ИИ - необработанные данные как есть, ни один коэффициент не вычищен. Полный, проверенный ИИ вариант - второй PDF рядом с этим (без пометки \"raw\" в названии)."
          : null,
      },
      outcomes: isTennis ? [["1", "П1"], ["2", "П2"]] : undefined,
      bookmakers: subset ? subset.map((slug) => BOOKMAKER_DISPLAY[slug] ?? slug) : bookmakers,
      moments: subset
        ? momentsArg.map((m) => {
            const keep = new Set(subset.map((slug) => BOOKMAKER_DISPLAY[slug] ?? slug));
            return {
              ...m,
              prices: Object.fromEntries(Object.entries(m.prices).filter(([name]) => keep.has(name))),
              unavailableNow: m.unavailableNow.filter((name) => keep.has(name)),
            };
          })
        : momentsArg,
    };
  }

  const reportsDir = path.join(__dirname, "reports");
  mkdirSync(reportsDir, { recursive: true });

  function renderPdf(momentsArg: typeof moments, aiSummaryArg: string | null, pdfPath: string, jsonSuffix: string, subset: string[] | null = null): boolean {
    const jsonPath = path.join(reportsDir, `${trackingId}${jsonSuffix}.input.json`);
    writeFileSync(jsonPath, JSON.stringify(buildPayload(momentsArg, aiSummaryArg, subset), null, 2), "utf-8");

    const result = spawnSync("python3", ["generate_live_report.py", jsonPath, pdfPath], {
      cwd: __dirname,
      encoding: "utf-8",
    });

    try {
      unlinkSync(jsonPath);
    } catch {
      // не критично, если не удалилось
    }

    if (result.status !== 0) {
      console.error(`[${trackingId}] generate_live_report.py упал (${pdfPath}):`, result.stdout, result.stderr);
      return false;
    }
    console.log(`[${trackingId}] отчёт готов: ${pdfPath}`);
    return true;
  }

  // Live-снимок пишется в ОТДЕЛЬНЫЙ файл (<id>.live.pdf, перезаписывается на каждый запрос)
  const sel = onlyBooks ? `.sel-${fileToken}` : "";
  const pdfPath = path.join(reportsDir, live ? `${trackingId}.live${sel}.pdf` : `${trackingId}${sel}.pdf`);
  if (!renderPdf(moments, aiSummary, pdfPath, sel, onlyBooks ? reportSlugs : null)) {
    process.exit(1);
  }

  // Второй PDF (только ULTRA, только финальный, не live-снимок)
  let reportPathRaw: string | null = null;
  if (rawMoments) {
    const rawPdfPath = path.join(reportsDir, `${trackingId}.raw${sel}.pdf`);
    if (renderPdf(rawMoments, null, rawPdfPath, `.raw${sel}`, onlyBooks ? reportSlugs : null)) {
      reportPathRaw = rawPdfPath;
    }
  }

  if (!live && !onlyBooks) {
    await prisma.liveTracking.update({
      where: { id: trackingId },
      data: { reportPath: pdfPath, ...(reportPathRaw ? { reportPathRaw } : {}) },
    });
    // Личные наборы контор аккаунтов (/status -> Отчёты): сразу готовим и такие варианты, ИИ-ответ уже есть - это пара секунд
    const doneKeys = new Set<string>();
    for (const wanted of await userReportSets()) {
    const subset = bookmakerSlugs.filter((slug) => wanted.includes(slug));
    // ключ считается по конторам ОТСЛЕЖИВАНИЯ (как в маршруте скачивания), а рисуем по тем, у кого есть данные
    const keySlugs = tracking.bookmakerSlugs.filter((slug) => wanted.includes(slug));
    if (subset.length > 0 && keySlugs.length > 0 && keySlugs.length < tracking.bookmakerSlugs.length) {
      const key = subsetKey(keySlugs);
      if (doneKeys.has(key)) continue;
      doneKeys.add(key);
      renderPdf(moments, aiSummary, path.join(reportsDir, `${trackingId}.sel-${key}.pdf`), `.sel-${key}`, subset);
      if (rawMoments) renderPdf(rawMoments, null, path.join(reportsDir, `${trackingId}.raw.sel-${key}.pdf`), `.raw.sel-${key}`, subset);
    }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
