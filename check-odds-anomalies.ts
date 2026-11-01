// Проверка "двойного расписания"/"разъехавшихся карточек"
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import * as fuzzball from "fuzzball";
import { isTopLeague, topLeagueKey } from "./lib/topLeagues";
import { isTopHockeyLeague, topHockeyKey } from "./lib/topHockey";
import { isTopTennisTournament } from "./lib/topTennis";
import { normalizeTeamForMatching } from "./lib/matching";

// без лимита пул Prisma = 2*ядра+1 (33) соединений, а в начале часа запросов к БД много
const dbUrl = process.env.DATABASE_URL || "";
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl + (dbUrl.includes("?") ? "&" : "?") + "connection_limit=5" } } } : undefined);
const ANOMALIES_LOG = path.join(__dirname, "anomalies.log");
const SEEN_PATH = path.join(__dirname, ".anomalies-seen.json");
const DEDUPE_HOURS = 24;

const OVERLAP_MS = 30 * 60 * 1000;
// Небольшой запас в прошлое
const WINDOW_START_MS = -3 * 60 * 60 * 1000;
const WINDOW_END_MS = 14 * 24 * 60 * 60 * 1000;
const CANDIDATE_THRESHOLD = 40;

function loadSeen(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(SEEN_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function logAnomaly(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(ANOMALIES_LOG, line + "\n");
}

// Киберспорт исключён
const CYBER_LEAGUE_RE = /кибер/i;

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || "https://example.com";
const AI_MODEL = process.env.AI_MODEL || "gemini-flash-lite-latest";
const LOW_COVERAGE_THRESHOLD = 3;
// без явного таймаута fetch() к AI может зависнуть на неопределённое время
const AI_TIMEOUT_MS = 90_000;
// КЛЮЧЕВАЯ находка объясняющая ВСЕ таймауты выше

type MatchWithLeague = Awaited<ReturnType<typeof prisma.match.findMany>>[number] & {
  league: { name: string; sport: { slug: string } };
  bookmakerMatches: { id: string; bookmakerId: string }[];
};

function pairScore(aHome: string, aAway: string, bHome: string, bAway: string): number {
  const aHomeN = normalizeTeamForMatching(aHome);
  const aAwayN = normalizeTeamForMatching(aAway);
  const bHomeN = normalizeTeamForMatching(bHome);
  const bAwayN = normalizeTeamForMatching(bAway);
  const direct = Math.min(fuzzball.token_set_ratio(aHomeN, bHomeN), fuzzball.token_set_ratio(aAwayN, bAwayN));
  const swapped = Math.min(fuzzball.token_set_ratio(aHomeN, bAwayN), fuzzball.token_set_ratio(aAwayN, bHomeN));
  return Math.max(direct, swapped);
}

interface CandidatePair {
  a: MatchWithLeague;
  b: MatchWithLeague;
  score: number;
}

// Кандидаты ищутся сортировкой по времени НАЧАЛА внутри каждого вида спорта + скользящим окном
function findCandidatePairs(matches: MatchWithLeague[]): CandidatePair[] {
  const bySport = new Map<string, MatchWithLeague[]>();
  for (const m of matches) {
    const key = m.league.sport.slug;
    if (!bySport.has(key)) bySport.set(key, []);
    bySport.get(key)!.push(m);
  }

  const pairs: CandidatePair[] = [];
  for (const group of bySport.values()) {
    group.sort((x, y) => x.kickoffAt.getTime() - y.kickoffAt.getTime());
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const diffMs = group[j].kickoffAt.getTime() - group[i].kickoffAt.getTime();
        if (diffMs >= OVERLAP_MS) break; // отсортировано - дальше пар в окне не будет
        const a = group[i];
        const b = group[j];
        const score = pairScore(a.homeTeam, a.awayTeam, b.homeTeam, b.awayTeam);
        if (score >= CANDIDATE_THRESHOLD) pairs.push({ a, b, score });
      }
    }
  }
  return pairs;
}

interface SamePairResult {
  results: { id: string; same: boolean; reason: string }[];
}

async function askAiSamePairs(
  pairs: { id: string; sport: string; league_a: string; teams_a: [string, string]; league_b: string; teams_b: [string, string] }[]
): Promise<SamePairResult> {
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
            "Ты проверяешь пары карточек спортивных матчей с сайта-агрегатора коэффициентов. Каждая пара - " +
            "это ДВЕ отдельные карточки с похожими именами команд и близким временем начала (обнаружены как " +
            "кандидаты через нечёткое сравнение строк). Для КАЖДОЙ пары определи: это ОДИН И ТОТ ЖЕ реальный " +
            "матч, который просто по-разному написан у разных букмекеров (тогда карточки нужно СЛИТЬ в одну), " +
            "или это ДВА РАЗНЫХ реальных матча, которые просто совпали по времени и похожи по написанию " +
            "(тогда сливать КАТЕГОРИЧЕСКИ НЕЛЬЗЯ - это безвозвратно уничтожит данные о втором матче). " +
            "БУДЬ ОЧЕНЬ ОСТОРОЖЕН, вот два проверенных на практике опасных паттерна, где нечёткое сравнение " +
            'строк ошибается: (1) РАЗНЫЕ клубы с общим словом-городом/брендом в названии - "Динамо Москва" и ' +
            '"Динамо Махачкала", "Спартак Москва" и "Спартак Кострома" - это ВСЕГДА разные клубы, даже если ' +
            'название частично совпадает - НЕ сливай. (2) Основная команда и её ДУБЛЬ/РЕЗЕРВ/молодёжка - "Зенит" ' +
            'и "Зенит-2"/"Зенит мол.", "X" и "X U21" - это ВСЕГДА разные сущности со своим отдельным турниром - ' +
            "НЕ сливай, даже если по буквам почти идентично. Сливай ТОЛЬКО если уверен, что расхождение - это " +
            'именно другая транслитерация/сокращение/написание ОДНОЙ И ТОЙ ЖЕ команды (например "Стэнуэй ' +
            'Роверс" и "Стануэй" - оба явно про один английский клуб Stanway Rovers, "Бургесс Хилл" и "Бургесс ' +
            'Хилл Таун" - тот же клуб с/без родового слова "Таун"). Если сомневаешься - ставь same:false, лучше ' +
            "пропустить настоящий дубль, чем случайно уничтожить данные о разных матчах. Верни ТОЛЬКО JSON " +
            'вида {"results": [{"id": "...", "same": true|false, "reason": "..."}]} - по одной записи на КАЖДУЮ ' +
            "пару из входных данных.",
        },
        { role: "user", content: JSON.stringify(pairs) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI не вернул content");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.results)) throw new Error("AI вернул неожиданный формат");
  return parsed;
}

async function mergeMatches(winnerId: string, loserId: string): Promise<{ merged: boolean; reason?: string }> {
  return prisma.$transaction(async (tx) => {
    const [winner, loser] = await Promise.all([
      tx.match.findUnique({ where: { id: winnerId }, include: { bookmakerMatches: true, liveTracking: true } }),
      tx.match.findUnique({ where: { id: loserId }, include: { bookmakerMatches: true, liveTracking: true } }),
    ]);
    if (!winner || !loser) return { merged: false, reason: "одна из карточек уже не существует (слита раньше в этом же прогоне?)" };
    if (winner.liveTracking.length > 0 || loser.liveTracking.length > 0) return { merged: false, reason: "у одной из карточек есть активный live-трекинг, не трогаем" };
    const winnerBookies = new Set(winner.bookmakerMatches.map((b) => b.bookmakerId));
    if (loser.bookmakerMatches.some((b) => winnerBookies.has(b.bookmakerId))) {
      return { merged: false, reason: "конторы пересекаются между карточками - подозрительно, не сливаем автоматически" };
    }
    await tx.bookmakerMatch.updateMany({ where: { matchId: loser.id }, data: { matchId: winner.id } });
    await tx.match.delete({ where: { id: loser.id } });
    return { merged: true };
  });
}

// Живой тест показал, что кандидатов на самом деле МНОГО (2728 при 3059 матчах в базе)
const AI_CHUNK_SIZE = 25;

async function checkSplitAndDoubleBookedMatches() {
  const now = Date.now();
  const allMatches = (await prisma.match.findMany({
    where: { kickoffAt: { gte: new Date(now + WINDOW_START_MS), lte: new Date(now + WINDOW_END_MS) } },
    include: { league: { include: { sport: true } }, bookmakerMatches: true },
    orderBy: { kickoffAt: "asc" },
  })) as MatchWithLeague[];
  const matches = allMatches.filter((m) => {
    if (CYBER_LEAGUE_RE.test(m.league.name)) return false;
    const sport = m.league.sport.slug;
    if (sport === "football") return isTopLeague(m.league.name);
    if (sport === "hockey") return isTopHockeyLeague(m.league.name);
    if (sport === "tennis") return isTopTennisTournament(m.league.name);
    return false;
  });

  const candidates = findCandidatePairs(matches);
  if (candidates.length === 0) {
    console.log(`[check-odds-anomalies] проверено матчей: ${matches.length}, кандидатов на дубль/конфликт: 0`);
    return;
  }

  const seen = loadSeen();
  const nowIso = new Date().toISOString();
  const dedupeMs = DEDUPE_HOURS * 3600 * 1000;

  const pairKeyOf = (c: CandidatePair) => [c.a.id, c.b.id].sort().join("|");
  const freshCandidates = candidates.filter((c) => {
    const lastSeen = seen[pairKeyOf(c)];
    return !(lastSeen && Date.now() - new Date(lastSeen).getTime() < dedupeMs);
  });
  const skippedDup = candidates.length - freshCandidates.length;

  const aiResults = new Map<number, { same: boolean; reason: string }>();
  if (AI_API_KEY && freshCandidates.length > 0) {
    for (let chunkStart = 0; chunkStart < freshCandidates.length; chunkStart += AI_CHUNK_SIZE) {
      const chunk = freshCandidates.slice(chunkStart, chunkStart + AI_CHUNK_SIZE);
      try {
        const payload = chunk.map((c, i) => ({
          id: String(i),
          sport: c.a.league.sport.slug,
          league_a: c.a.league.name,
          teams_a: [c.a.homeTeam, c.a.awayTeam] as [string, string],
          league_b: c.b.league.name,
          teams_b: [c.b.homeTeam, c.b.awayTeam] as [string, string],
        }));
        const result = await askAiSamePairs(payload);
        for (const r of result.results) {
          const idx = Number(r.id);
          if (!Number.isNaN(idx) && chunk[idx]) aiResults.set(chunkStart + idx, { same: r.same, reason: r.reason });
        }
      } catch (e) {
        console.error(
          `[check-odds-anomalies] ИИ-проверка пачки пар (${chunkStart}-${chunkStart + chunk.length}) упала, эти пары уйдут только как предупреждения:`,
          (e as Error).message
        );
      }
    }
  }

  let merged = 0;
  let warned = 0;

  for (let i = 0; i < freshCandidates.length; i++) {
    const { a, b, score } = freshCandidates[i];
    const verdict = aiResults.get(i);

    if (verdict?.same) {
      const [winner, loser] = a.bookmakerMatches.length >= b.bookmakerMatches.length ? [a, b] : [b, a];
      const result = await mergeMatches(winner.id, loser.id);
      if (result.merged) {
        merged++;
        logAnomaly(
          `СВЕДЕНИЕ: "${loser.homeTeam} - ${loser.awayTeam}" (${loser.league.name}, id=${loser.id}) слита в ` +
            `"${winner.homeTeam} - ${winner.awayTeam}" (${winner.league.name}, id=${winner.id}) - ИИ подтвердил один и тот же матч: ${verdict.reason}`
        );
      } else {
        logAnomaly(
          `СВЕДЕНИЕ ОТМЕНЕНО (защита): "${a.homeTeam} - ${a.awayTeam}" (id=${a.id}) vs "${b.homeTeam} - ${b.awayTeam}" (id=${b.id}) - ${result.reason}`
        );
      }
      continue;
    }

    if (verdict) {
      seen[[a.id, b.id].sort().join("|")] = nowIso;
    }
    warned++;
    logAnomaly(
      `ДВОЙНОЕ РАСПИСАНИЕ (score=${score}): "${a.homeTeam} - ${a.awayTeam}" (${a.kickoffAt.toISOString()}, ${a.league.name}, id=${a.id}) ` +
        `vs "${b.homeTeam} - ${b.awayTeam}" (${b.kickoffAt.toISOString()}, ${b.league.name}, id=${b.id})` +
        (verdict ? ` - ИИ считает это РАЗНЫМИ матчами: ${verdict.reason}` : " - ИИ недоступен, будет перепроверено на следующем прогоне")
    );
  }

  fs.writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2));
  console.log(
    `[check-odds-anomalies] проверено матчей: ${matches.length}, кандидатов: ${candidates.length}, свежих (не в дедупе): ${freshCandidates.length}, слито: ${merged}, предупреждений (новых): ${warned}, повторов пропущено: ${skippedDup}`
  );
}

interface AiFlagResult {
  flagged: { id: string; reason: string }[];
}

async function askAiTopLeagues(matches: { id: string; label: string; league: string; sport: string; coverage: number }[]): Promise<AiFlagResult> {
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
            `Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}. ` +
            "Ты проверяешь список спортивных событий, которые сайт-агрегатор коэффициентов относит к " +
            "ГЛАВНЫМ/ТОП-турнирам своего вида спорта (АПЛ, НХЛ регулярный сезон, Уимблдон и т.п. - НЕ " +
            "молодёжные/резервные/товарищеские/киберспортивные/статистические спецрынки). Твоя задача - " +
            "найти в списке события, которые НЕ являются главным турниром лиги, хотя туда " +
            "классифицированы - например второстепенный/предсезонный/молодёжный турнир под похожим " +
            "названием, явный киберспорт (ники игроков вместо команд, очень короткие матчи), фиктивный " +
            "спецрынок вместо настоящего матча (сравнение статистики, а не реальная игра команда-на-команду). " +
            "ВАЖНО - это НЕ признаки подделки, игнорируй их полностью: обозначение сезона в названии лиги " +
            'вида "Сезон 26/27"/"2026-2027" (европейские футбольные/хоккейные сезоны всегда охватывают два ' +
            "календарных года - это нормальная текущая формулировка, а не намёк на будущее время); обычные " +
            "названия команд без ников в скобках; малоизвестные/небольшие страны и клубы сами по себе (это " +
            "просто менее популярная лига, не подделка); декоративное оформление названия лиги от " +
            "конкретной конторы вида \"Ставки на Примейра Лига 🥈 Футбол ǀ Португалия ǀ БК Book D\"/" +
            "\"Футбол 🏆 АПЛ • Ставки в БК Book D\" (эмодзи/иконки, слово \"Ставки\"/\"БК\", вертикальная черта-" +
            "разделитель \"ǀ\") - это ОБЫЧНЫЙ маркетинговый формат названия у Book D специфично для реальных " +
            "лиг (проверено живьём - десятки настоящих топ-матчей АПЛ/Ла Лиги/Лиги чемпионов приходят " +
            "именно в таком виде), а НЕ признак фиктивного спецрынка - настоящий фиктивный спецрынок " +
            "выглядит иначе (сравнение статистики вместо счёта, ники игроков вместо команд, что уже " +
            "описано выше) - сама по себе цветастость/маркетинговый мусор в НАЗВАНИИ ЛИГИ ничего не " +
            "доказывает. НИКОГДА не помечай матч только на основании того, " +
            "что ты (по своим знаниям) не ожидал увидеть именно ЭТУ команду именно в ЭТОЙ лиге/сезоне - " +
            "составы лиг меняются каждый сезон (повышения/понижения в классе, трансферы), а твои знания о " +
            "текущем составе конкретной лиги в конкретном сезоне могут быть устаревшими или неполными - это " +
            "НЕ надёжный признак подделки, даже если тебе кажется странным. Подозрительны ТОЛЬКО признаки, " +
            "видимые прямо в самих данных (упомянуты в абзаце выше) - не догадки о том, кто должен играть в " +
            "лиге по твоим собственным знаниям. " +
            `У каждого события указано поле coverage - у скольких букмекерских контор из 8 есть коэффициент ` +
            `на это событие; coverage < ${LOW_COVERAGE_THRESHOLD} - слабое покрытие, самый частый признак подделки на практике, но ` +
            "решай по совокупности признаков, не только по этому числу - у топ-лиги само по себе низкое " +
            "покрытие ещё не повод для пометки, если название и состав команд выглядят нормально. Верни " +
            'ТОЛЬКО JSON-объект вида {"flagged": [{"id": "...", "reason": "..."}]} - ТОЛЬКО события, где ты ' +
            'уверен, что это НЕ главный турнир лиги. Если подозрительных нет - верни {"flagged": []}. Лучше ' +
            "пропустить сомнительный случай, чем ошибочно пометить нормальный матч.",
        },
        { role: "user", content: JSON.stringify(matches) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI не вернул content");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.flagged)) throw new Error("AI вернул неожиданный формат");
  return parsed;
}

async function runAiTopLeagueReview() {
  if (!AI_API_KEY) {
    console.log("[check-odds-anomalies] AI_API_KEY не задан - ИИ-проверки пропущены (и топ-лиг, и сведения дублей)");
    return;
  }

  const now = Date.now();
  const matches = await prisma.match.findMany({
    where: { kickoffAt: { gte: new Date(now - 3 * 3600 * 1000), lte: new Date(now + 7 * 24 * 3600 * 1000) } },
    include: { league: { include: { sport: true } }, bookmakerMatches: true },
  });

  const isNhlPreseason = (m: (typeof matches)[number]) =>
    m.league.sport.slug === "hockey" && topHockeyKey(m.league.name) === "НХЛ (предсезон)";
  const isNationalTeamFriendly = (m: (typeof matches)[number]) =>
    m.league.sport.slug === "football" && topLeagueKey(m.league.name) === "Сборные. Товарищеские матчи";
  const skipAiReview = (m: (typeof matches)[number]) => isNhlPreseason(m) || isNationalTeamFriendly(m);
  const unansweredSkipped = matches.filter((m) => skipAiReview(m) && m.topLeagueReviewAnswer === null);
  if (unansweredSkipped.length > 0) {
    await Promise.all(
      unansweredSkipped.map((m) =>
        prisma.match.update({ where: { id: m.id }, data: { topLeagueFlagged: false, topLeagueFlagReason: null } })
      )
    );
  }

  const topMatches = matches.filter((m) => {
    if (m.topLeagueReviewAnswer !== null) return false;
    if (skipAiReview(m)) return false;
    const sport = m.league.sport.slug;
    if (sport === "football") return isTopLeague(m.league.name);
    if (sport === "hockey") return isTopHockeyLeague(m.league.name);
    if (sport === "tennis") return isTopTennisTournament(m.league.name);
    return false;
  });

  if (topMatches.length === 0) {
    console.log("[check-odds-anomalies] топ-лиг для ИИ-проверки сейчас нет");
    return;
  }

  const payload = topMatches.map((m) => ({
    id: m.id,
    label: `${m.homeTeam} - ${m.awayTeam}`,
    league: m.league.name,
    sport: m.league.sport.slug,
    coverage: new Set(m.bookmakerMatches.map((bm) => bm.bookmakerId)).size,
  }));

  let result: AiFlagResult;
  try {
    result = await askAiTopLeagues(payload);
  } catch (e) {
    console.error("[check-odds-anomalies] ИИ-проверка топ-лиг упала:", (e as Error).message);
    return;
  }

  const flaggedIds = new Set(result.flagged.map((f) => f.id));
  const reasonById = new Map(result.flagged.map((f) => [f.id, f.reason]));

  const seen = loadSeen();
  const nowIso = new Date().toISOString();
  const dedupeMs = DEDUPE_HOURS * 3600 * 1000;
  let logged = 0;
  for (const f of result.flagged) {
    const m = topMatches.find((x) => x.id === f.id);
    if (!m) continue; // ИИ мог вернуть несуществующий id - не доверяем вслепую
    // почти все пометки были «Low coverage duplicate»
    if (/duplicate|дубл/i.test(String(f.reason))) continue;
    const key = `ai:${m.id}`;
    if (seen[key] && Date.now() - new Date(seen[key]).getTime() < dedupeMs) continue;
    seen[key] = nowIso;
    logged++;
    logAnomaly(
      `ИИ-ПРОВЕРКА: "${m.homeTeam} - ${m.awayTeam}" (${m.league.name}, ${m.league.sport.slug}, id=${m.id}) ` +
        `похоже НЕ главный турнир лиги - ${f.reason}`
    );
  }
  fs.writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2));

  // "Помогите Betmark" - синхронизируем Match.topLeagueFlagged с вердиктом ЭТОГО прогона для ВСЕХ ещё не отвеченных
  await Promise.all(
    topMatches.map((m) =>
      prisma.match.update({
        where: { id: m.id },
        data: {
          topLeagueFlagged: flaggedIds.has(m.id),
          topLeagueFlagReason: reasonById.get(m.id) ?? null,
        },
      })
    )
  );

  console.log(`[check-odds-anomalies] ИИ проверил топ-лиг: ${payload.length}, помечено сейчас: ${flaggedIds.size}, новых в лог: ${logged}`);
}

async function main() {
  await checkSplitAndDoubleBookedMatches();
  await runAiTopLeagueReview();
}

main()
  .catch((e) => {
    console.error("[check-odds-anomalies] ошибка:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
