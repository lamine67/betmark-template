import { PrismaClient, MarketType } from "@prisma/client";
import * as fuzzball from "fuzzball";
import { decideReversed, consensus } from "./lib/orientation";
import * as fs from "fs";
import * as path from "path";
import { normalizeTeamForMatching, hasConflictingMarker } from "./lib/matching";
import { isWomenMatch } from "./lib/topLeagues";
import { isCryptoSlug } from "./lib/cryptoBooks";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
const LOG = path.join(__dirname, "ai-dedup.log");
const SEEN_PATH = path.join(__dirname, ".ai-dedup-seen.json");

const WINDOW_BEFORE_MS = -3 * 3600 * 1000;
const WINDOW_AFTER_MS = 8 * 24 * 3600 * 1000;
const PAIR_WINDOW_MS = 60 * 60 * 1000;
const MERGE_MAX_DIFF_MS = 90 * 60 * 1000;
const CANDIDATE_MIN = 60;
const RELAXED_MIN = 30;
const RELAXED_SLOT_MS = 10 * 60 * 1000;
const SEEN_HOURS = 12;
const AI_CHUNK = 20;
const MAX_AI_PAIRS = 1200;
const MAX_MERGES = 1200;
const AI_PARALLEL = 4;

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || "https://example.com";
const AI_MODEL = process.env.AI_MODEL || "gemini-flash-lite-latest";

type M = Awaited<ReturnType<typeof loadMatches>>[number];

function log(msg: string) {
  const line = `${new Date().toISOString()} ${DRY ? "[dry] " : ""}${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + "\n");
  } catch {}
}

function loadSeen(): Record<string, { t: string; v: string }> {
  try {
    return JSON.parse(fs.readFileSync(SEEN_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function loadMatches() {
  const now = Date.now();
  return prisma.match.findMany({
    where: { kickoffAt: { gte: new Date(now + WINDOW_BEFORE_MS), lte: new Date(now + WINDOW_AFTER_MS) } },
    include: { league: { include: { sport: true } }, bookmakerMatches: { include: { bookmaker: true } }, liveTracking: true },
    orderBy: { kickoffAt: "asc" },
  });
}

// score и признак "команды в обратном порядке" (swapped лучше direct) Кибер-матчи
const CYBER_RE = /кибер|e-?sport|cyber|virtual|симуляц|fifas*d|ебаск/i;
const isCyber = (m: M) => CYBER_RE.test(m.league.name) || /[()]/.test(m.homeTeam + m.awayTeam);
const womenFlag = (m: M) => isWomenMatch({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, league: m.league.name });

const TRANSLIT_DIGRAPHS: [string, string][] = [["sch", "щ"], ["sh", "ш"], ["ch", "ч"], ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ya", "я"], ["yu", "ю"], ["yo", "ё"], ["ph", "ф"], ["th", "т"], ["ck", "к"], ["ee", "и"], ["oo", "у"]];
const TRANSLIT_SINGLE: Record<string, string> = { a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "и", z: "з" };
function latinToCyrillic(name: string): string {
  if (!/[a-z]/i.test(name)) return name;
  let s = name.toLowerCase();
  for (const [lat, cyr] of TRANSLIT_DIGRAPHS) s = s.split(lat).join(cyr);
  return s.replace(/[a-z]/g, (ch) => TRANSLIT_SINGLE[ch] ?? ch);
}

function pairScore(a: M, b: M): { score: number; direct: number; swapped: number } {
  const an = [normalizeTeamForMatching(a.homeTeam), normalizeTeamForMatching(a.awayTeam)];
  const bn = [normalizeTeamForMatching(b.homeTeam), normalizeTeamForMatching(b.awayTeam)];
  const r = (x: string, y: string) => {
    const base = fuzzball.token_set_ratio(x, y);
    const lx = latinToCyrillic(x);
    const ly = latinToCyrillic(y);
    if (lx === x && ly === y) return base;
    // оценка через транслитерацию: 100 ("слить без ИИ")
    const viaTranslit = fuzzball.ratio(lx, ly) >= 90 ? 100 : Math.min(fuzzball.token_set_ratio(lx, ly), 99);
    return Math.max(base, viaTranslit);
  };
  const direct = hasConflictingMarker(an[0], bn[0]) || hasConflictingMarker(an[1], bn[1]) ? 0 : Math.min(r(an[0], bn[0]), r(an[1], bn[1]));
  const swapped = hasConflictingMarker(an[0], bn[1]) || hasConflictingMarker(an[1], bn[0]) ? 0 : Math.min(r(an[0], bn[1]), r(an[1], bn[0]));
  // ориентацию тут не решаем
  return { score: Math.max(direct, swapped), direct, swapped };
}

interface Cand { a: M; b: M; score: number; direct: number; swapped: number; reversed: boolean }

function findCandidates(matches: M[]): Cand[] {
  const bySport = new Map<string, M[]>();
  for (const m of matches) {
    const k = m.league.sport.slug;
    if (!bySport.has(k)) bySport.set(k, []);
    bySport.get(k)!.push(m);
  }
  const out: Cand[] = [];
  for (const group of bySport.values()) {
    group.sort((x, y) => x.kickoffAt.getTime() - y.kickoffAt.getTime());
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[j].kickoffAt.getTime() - group[i].kickoffAt.getTime() > PAIR_WINDOW_MS) break;
        if (isCyber(group[i]) || isCyber(group[j])) continue;
        const { score, direct, swapped } = pairScore(group[i], group[j]);
        // послабление только для карточек, состоящих ИСКЛЮЧИТЕЛЬНО из Book Q (английские сокращения)
        const bookqOnly = (m: M) => m.bookmakerMatches.length > 0 && m.bookmakerMatches.every((bm) => bm.bookmaker.slug === "bookq" || bm.bookmaker.slug === "bookn");
        const hasRegular = (m: M) => m.bookmakerMatches.some((bm) => !isCryptoSlug(bm.bookmaker.slug));
        const relaxed =
          score >= RELAXED_MIN &&
          Math.abs(group[j].kickoffAt.getTime() - group[i].kickoffAt.getTime()) <= RELAXED_SLOT_MS &&
          ((bookqOnly(group[i]) && hasRegular(group[j])) || (bookqOnly(group[j]) && hasRegular(group[i])));
        if (score >= CANDIDATE_MIN || relaxed) out.push({ a: group[i], b: group[j], score: Math.min(score, 99), direct, swapped, reversed: false });
      }
    }
  }
  return out;
}

async function askAi(pairs: unknown[]): Promise<{ id: string; same: boolean; confidence: string; reason: string }[]> {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AI_API_KEY}` },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      enable_thinking: false,
      messages: [
        {
          role: "system",
          content:
            "Ты проверяешь пары карточек спортивных матчей с сайта-агрегатора коэффициентов. Каждая пара - ДВЕ отдельные " +
            "карточки с похожими названиями команд и близким временем начала. Для КАЖДОЙ пары реши: это ОДИН И ТОТ ЖЕ " +
            "реальный матч, по-разному записанный разными букмекерами (карточки нужно СЛИТЬ), или ДВА РАЗНЫХ матча " +
            "(сливать КАТЕГОРИЧЕСКИ НЕЛЬЗЯ - это безвозвратно уничтожит данные). Типичные одинаковые записи: сокращения " +
            '("Динамо Мн" = "Динамо Минск", "Локомотив" = "Локомотив Ярославль" при одной лиге), разная транслитерация, ' +
            'лишнее родовое слово ("ФК", "Таун"), порядок команд может быть обратным. ОПАСНЫЕ случаи, где сливать НЕЛЬЗЯ: ' +
            '(1) разные клубы с общим словом-городом/брендом ("Динамо Москва" и "Динамо Махачкала", "Спартак Москва" и ' +
            '"Спартак Кострома"); (2) основная команда и её дубль/резерв/молодёжка ("Зенит" и "Зенит-2", "X" и "X U21", ' +
            '"Реал Мадрид" и "Реал Мадрид Кастилья"); (3) мужская и женская команды; (4) разные возрастные группы; ' +
            "(5) кибер-матч (игрок в скобках) и настоящий матч. Если команды явно разные или хоть чуть сомневаешься - " +
            "same:false. Время начала (kickoff_a/kickoff_b, UTC) и списки контор (books_a/books_b) даны для контекста: " +
            "у одной конторы может быть записано одно и то же событие дважды, это не признак разных матчей. Верни ТОЛЬКО " +
            'JSON {"results":[{"id":"...","same":true|false,"confidence":"high"|"low","reason":"кратко"}]} - по записи на ' +
            'КАЖДУЮ пару; "high" ставь только если на 100% уверен, что это одна и та же пара команд.',
        },
        { role: "user", content: JSON.stringify(pairs) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  if (!Array.isArray(parsed.results)) throw new Error("AI: неожиданный формат ответа");
  return parsed.results;
}

// слияние
type Odds = Partial<Record<"1" | "X" | "2", number>>;

function probs(o: Odds): Odds | null {
  const keys = (Object.keys(o) as (keyof Odds)[]).filter((k) => o[k]! > 1);
  if (keys.length < 2) return null;
  const inv = Object.fromEntries(keys.map((k) => [k, 1 / o[k]!])) as Odds;
  const sum = keys.reduce((s, k) => s + inv[k]!, 0);
  return Object.fromEntries(keys.map((k) => [k, inv[k]! / sum])) as Odds;
}
const flip = (o: Odds): Odds => ({ ...o, ...(o["1"] !== undefined ? { "2": o["1"] } : {}), ...(o["2"] !== undefined ? { "1": o["2"] } : {}) });

async function latestOdds(tx: Prisma, ids: string[]): Promise<Map<string, Odds>> {
  const rows = await tx.oddsSnapshot.findMany({
    where: { bookmakerMatchId: { in: ids }, market: { in: [MarketType.MATCH_WINNER_1X2, MarketType.MATCH_WINNER_2WAY] } },
    orderBy: { capturedAt: "desc" },
    select: { bookmakerMatchId: true, outcome: true, price: true },
  });
  const out = new Map<string, Odds>();
  for (const r of rows) {
    const cur = out.get(r.bookmakerMatchId) ?? {};
    if (cur[r.outcome as "1"] === undefined && ["1", "X", "2"].includes(r.outcome)) cur[r.outcome as "1"] = r.price;
    out.set(r.bookmakerMatchId, cur);
  }
  return out;
}
type Prisma = Pick<PrismaClient, "oddsSnapshot">;

// ориентация пары карточек
async function resolveOrientation(cands: Cand[]): Promise<void> {
  const ids = [...new Set(cands.flatMap((c) => [...c.a.bookmakerMatches, ...c.b.bookmakerMatches].map((bm) => bm.id)))];
  const odds = ids.length ? await latestOdds(prisma, ids) : new Map<string, Odds>();
  const cardOdds = (m: M): Odds[] => {
    const rows = m.bookmakerMatches.map((bm) => ({ crypto: isCryptoSlug(bm.bookmaker.slug), o: odds.get(bm.id) })).filter((r) => r.o) as { crypto: boolean; o: Odds }[];
    const regular = rows.filter((r) => !r.crypto);
    return (regular.length ? regular : rows).map((r) => r.o);
  };
  for (const c of cands) {
    const consB = consensus(cardOdds(c.b));
    const ownB: Odds | null = consB ? (Object.fromEntries(Object.entries(consB).map(([k, q]) => [k, 1 / q!])) as Odds) : null;
    c.reversed = decideReversed(c.direct, c.swapped, ownB, cardOdds(c.a));
  }
}

function dist(a: Odds, b: Odds): number {
  let d = 0, n = 0;
  for (const k of Object.keys(a) as (keyof Odds)[]) if (b[k] !== undefined) { d += Math.abs(a[k]! - b[k]!); n++; }
  return n ? d / n : 1;
}

export async function mergeInto(keeperId: string, loserId: string, reversed: boolean): Promise<string> {
  return prisma.$transaction(
    async (tx) => {
      const [k, l] = await Promise.all([
        tx.match.findUnique({ where: { id: keeperId }, include: { bookmakerMatches: { include: { bookmaker: true } }, liveTracking: true } }),
        tx.match.findUnique({ where: { id: loserId }, include: { bookmakerMatches: { include: { bookmaker: true } }, liveTracking: true } }),
      ]);
      if (!k || !l) return "пропуск: одна из карточек уже не существует";
      if (k.liveTracking.length > 0 || l.liveTracking.length > 0) return "пропуск: идёт live-трекинг";
      if (Math.abs(k.kickoffAt.getTime() - l.kickoffAt.getTime()) > MERGE_MAX_DIFF_MS) return "пропуск: время начала расходится больше 90 мин";

      const kByBook = new Map(k.bookmakerMatches.map((b) => [b.bookmakerId, b]));
      const overlapIds = l.bookmakerMatches.filter((b) => kByBook.has(b.bookmakerId)).flatMap((b) => [b.id, kByBook.get(b.bookmakerId)!.id]);
      const odds = overlapIds.length ? await latestOdds(tx, [...overlapIds, ...k.bookmakerMatches.map((b) => b.id)]) : new Map<string, Odds>();
      const notes: string[] = [];

      for (const lb of l.bookmakerMatches) {
        const kb = kByBook.get(lb.bookmakerId);
        let move = !kb;
        if (kb) {
          // две записи одной конторы на один матч - оставляем ту, что ближе к консенсусу остальных контор карточки-победителя
          const others = k.bookmakerMatches.filter((b) => b.bookmakerId !== lb.bookmakerId).map((b) => probs(odds.get(b.id) ?? {})).filter(Boolean) as Odds[];
          const avg: Odds = {};
          for (const key of ["1", "X", "2"] as const) {
            const vals = others.map((o) => o[key]).filter((v) => v !== undefined) as number[];
            if (vals.length) avg[key] = vals.reduce((s, v) => s + v, 0) / vals.length;
          }
          const kp = probs(odds.get(kb.id) ?? {});
          let lo = odds.get(lb.id) ?? {};
          if (reversed || lb.teamsSwapped !== kb.teamsSwapped) lo = reversed ? flip(lo) : lo;
          const lp = probs(lo);
          const useLoser = others.length >= 2 && kp && lp && dist(lp, avg) + 0.005 < dist(kp, avg);
          notes.push(`${lb.bookmaker.slug}: оставлена запись ${useLoser ? "двойника" : "основной карточки"}`);
          if (useLoser) {
            await tx.bookmakerMatch.delete({ where: { id: kb.id } });
            move = true;
          } else {
            await tx.bookmakerMatch.delete({ where: { id: lb.id } });
          }
        }
        if (move) {
          if (reversed) {
            await tx.$executeRaw`UPDATE "OddsSnapshot" SET outcome = CASE outcome WHEN '1' THEN '2' WHEN '2' THEN '1' ELSE outcome END WHERE "bookmakerMatchId" = ${lb.id} AND market IN ('MATCH_WINNER_1X2', 'MATCH_WINNER_2WAY')`;
          }
          await tx.bookmakerMatch.update({ where: { id: lb.id }, data: { matchId: k.id, ...(reversed ? { teamsSwapped: !lb.teamsSwapped } : {}) } });
        }
      }
      await tx.match.delete({ where: { id: l.id } });
      return "слито" + (notes.length ? ` (${notes.join("; ")})` : "") + (reversed ? " [обратный порядок команд, исходы 1/2 развёрнуты]" : "");
    },
    { timeout: 60_000 }
  );
}

function label(m: M): string {
  return `"${m.homeTeam}" - "${m.awayTeam}" @${m.kickoffAt.toISOString().slice(5, 16)} [${m.bookmakerMatches.map((b) => b.bookmaker.slug).join(",")}]`;
}

async function main() {
  const t0 = Date.now();
  const matches = await loadMatches();
  const cands = findCandidates(matches);
  await resolveOrientation(cands);
  const seen = loadSeen();
  const seenCut = Date.now() - SEEN_HOURS * 3600 * 1000;
  const key = (c: Cand) => [c.a.id, c.b.id].sort().join("|");
  const fresh = cands.filter((c) => !(seen[key(c)] && new Date(seen[key(c)].t).getTime() > seenCut));

  // keeper: больше контор, при равенстве - более старая карточка
  const orient = (c: Cand) => {
    const aBigger = c.a.bookmakerMatches.length > c.b.bookmakerMatches.length || (c.a.bookmakerMatches.length === c.b.bookmakerMatches.length && c.a.createdAt <= c.b.createdAt);
    return aBigger ? { keeper: c.a, loser: c.b } : { keeper: c.b, loser: c.a };
  };

  let merged = 0, aiAsked = 0, aiSame = 0, aiDiff = 0, errors = 0;
  const gone = new Set<string>();
  const doMerge = async (c: Cand, why: string) => {
    if (merged >= MAX_MERGES) return;
    const { keeper, loser } = orient(c);
    if (gone.has(keeper.id) || gone.has(loser.id)) return;
    if (DRY) { log(`СЛИЛИ БЫ (${why}, s=${c.score}) KEEP ${label(keeper)} <- DROP ${label(loser)}${c.reversed ? " [обратный порядок]" : ""}`); gone.add(loser.id); merged++; return; }
    const r = await mergeInto(keeper.id, loser.id, c.reversed);
    log(`${r.startsWith("слито") ? "СЛИТО" : "ПРОПУЩЕНО"} (${why}, s=${c.score}) KEEP ${label(keeper)} <- DROP ${label(loser)}: ${r}`);
    if (r.startsWith("слито")) { gone.add(loser.id); merged++; } else seen[key(c)] = { t: new Date().toISOString(), v: "refused" };
  };

  // 1) точные совпадения - без ИИ
  for (const c of fresh.filter((c) => c.score === 100 && womenFlag(c.a) === womenFlag(c.b))) await doMerge(c, "точное совпадение");

  // 2) остальные - AI
  const toAsk = fresh.filter((c) => (c.score < 100 || womenFlag(c.a) !== womenFlag(c.b)) && !gone.has(c.a.id) && !gone.has(c.b.id)).sort((x, y) => y.score - x.score || Math.min(x.a.kickoffAt.getTime(), x.b.kickoffAt.getTime()) - Math.min(y.a.kickoffAt.getTime(), y.b.kickoffAt.getTime())).slice(0, MAX_AI_PAIRS);
  if (toAsk.length && !AI_API_KEY) log("AI_API_KEY не задан - пропускаю ИИ-часть");
  else {
    // ответы ИИ запрашиваются параллельно, а слияния применяются по очереди (gone/MAX_MERGES проверяются в doMerge)
    const starts: number[] = [];
    for (let i = 0; i < toAsk.length; i += AI_CHUNK) starts.push(i);
    const answers = new Map<number, Promise<Awaited<ReturnType<typeof askAi>>>>();
    const ask = (i: number) => {
      const chunk = toAsk.slice(i, i + AI_CHUNK);
      const payload = chunk.map((c, n) => ({
        id: String(n), sport: c.a.league.sport.slug,
        league_a: c.a.league.name, teams_a: [c.a.homeTeam, c.a.awayTeam], kickoff_a: c.a.kickoffAt.toISOString().slice(11, 16), books_a: c.a.bookmakerMatches.map((b) => b.bookmaker.slug),
        league_b: c.b.league.name, teams_b: [c.b.homeTeam, c.b.awayTeam], kickoff_b: c.b.kickoffAt.toISOString().slice(11, 16), books_b: c.b.bookmakerMatches.map((b) => b.bookmaker.slug),
      }));
      const pr = askAi(payload);
      pr.catch(() => {});
      answers.set(i, pr);
    };
    starts.slice(0, AI_PARALLEL).forEach(ask);
    for (let k = 0; k < starts.length; k++) {
      const i = starts[k];
      if (k + AI_PARALLEL < starts.length) ask(starts[k + AI_PARALLEL]);
      const chunk = toAsk.slice(i, i + AI_CHUNK);
      let verdicts: Awaited<ReturnType<typeof askAi>>;
      try {
        verdicts = await answers.get(i)!;
        aiAsked += chunk.length;
      } catch (e) {
        errors++;
        log(`ошибка AI на пачке ${i / AI_CHUNK + 1}: ${(e as Error).message}`);
        continue;
      }
      for (const v of verdicts) {
        const c = chunk[Number(v.id)];
        if (!c) continue;
        if (v.same && v.confidence === "high") {
          aiSame++;
          await doMerge(c, `ИИ: ${String(v.reason).slice(0, 80)}`);
        } else {
          aiDiff++;
          seen[key(c)] = { t: new Date().toISOString(), v: "different" };
          if (v.same) log(`ИИ считает дублем, но уверенность низкая - не трогаю: ${label(c.a)} | ${label(c.b)} (${String(v.reason).slice(0, 80)})`);
        }
      }
    }
  }

  if (!DRY) {
    const cutoff = Date.now() - 48 * 3600 * 1000;
    for (const k of Object.keys(seen)) if (new Date(seen[k].t).getTime() < cutoff) delete seen[k];
    fs.writeFileSync(SEEN_PATH, JSON.stringify(seen));
  }
  log(`итог: матчей ${matches.length}, кандидатов ${cands.length} (новых ${fresh.length}), слито ${merged}, спросили ИИ о ${aiAsked} парах (дубль ${aiSame}, разные/неуверен ${aiDiff}), ошибок ${errors}, ${Math.round((Date.now() - t0) / 1000)} c`);
  await prisma.$disconnect();
}

if (process.argv[1] && process.argv[1].endsWith("ai-dedup.ts")) {
  main().catch(async (e) => {
    log(`ОШИБКА: ${e instanceof Error ? e.stack : e}`);
    await prisma.$disconnect();
    process.exit(1);
  });
}
