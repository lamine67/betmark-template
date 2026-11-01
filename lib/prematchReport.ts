import type { PrismaClient } from "@prisma/client";
import { PREMATCH_BOOK_ORDER, prematchBookName } from "./prematchBooks";
import { staleCutoff } from "./freshness";

export { PREMATCH_BOOK_ORDER, prematchBookName };
export const PREMATCH_THRESHOLDS = [0.01, 0.02, 0.03, 0.05, 0.08];
const MAX_MOMENTS = 60;
const BUCKET_MS = 120_000; // снимки одного опроса пишутся по строке на исход с разницей в секунды - склеиваем в один момент

type Outcome = "1" | "X" | "2";
type Cell = Partial<Record<Outcome, number>>;
type Prices = Record<string, { "1": number | null; X: number | null; "2": number | null } | null>;

export interface PrematchMoment {
  time: string;
  isGoal: false;
  goalTeam: null;
  matchMinute: null;
  scoreHome: null;
  scoreAway: null;
  prices: Prices;
  unavailableNow: string[];
}

export interface PrematchPayload {
  match: Record<string, unknown>;
  bookmakers: string[];
  moments: PrematchMoment[];
  outcomes: [string, string][];
}

export class PrematchReportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
function fmtMsk(d: Date, withYear = false): string {
  const m = new Date(d.getTime() + 3 * 3600_000);
  return `${pad(m.getUTCDate())}.${pad(m.getUTCMonth() + 1)}${withYear ? "." + m.getUTCFullYear() : ""} ${pad(m.getUTCHours())}:${pad(m.getUTCMinutes())}`;
}
function lead(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const mm = mins % 60;
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${pad(mm)} мин`;
  return `${mm} мин`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (a: number, b: number) => ((b - a) / a) * 100;

export async function buildPrematchPayload(prisma: PrismaClient, matchId: string, only: string[] | null): Promise<PrematchPayload> {
  const match = await prisma.match.findUnique({ where: { id: matchId }, include: { league: { include: { sport: true } } } });
  if (!match) throw new PrematchReportError("матч не найден", 404);
  const sportSlug = match.league.sport.slug;
  const isTennis = sportSlug === "tennis";
  const outcomes: [Outcome, string][] = isTennis ? [["1", "П1"], ["2", "П2"]] : [["1", "П1"], ["X", "X"], ["2", "П2"]];
  const market = isTennis ? "MATCH_WINNER_2WAY" : "MATCH_WINNER_1X2";
  const now = new Date();
  const past = match.kickoffAt.getTime() <= now.getTime();
  const end = past ? match.kickoffAt : now; // после начала матча линия закрыта: отчёт идёт до старта

  const rows = await prisma.$queryRaw<{ slug: string; outcome: string; price: number; at: Date }[]>`
    SELECT b.slug, o.outcome, o.price, o."capturedAt" AS at
    FROM "OddsSnapshot" o
    JOIN "BookmakerMatch" bm ON bm.id = o."bookmakerMatchId"
    JOIN "Bookmaker" b ON b.id = bm."bookmakerId"
    WHERE bm."matchId" = ${matchId} AND o.market::text = ${market} AND o."capturedAt" <= ${end}
    ORDER BY o."capturedAt" ASC`;
  if (rows.length === 0) throw new PrematchReportError("по этому матчу нет сохранённых кэфов", 404);

  const withData = new Set(rows.map((r) => r.slug));
  const order = (slug: string) => {
    const i = PREMATCH_BOOK_ORDER.indexOf(slug);
    return i === -1 ? 999 : i;
  };
  // колонки: личный набор прематча (если задан) или все конторы с данными
  const columns = (only && only.length > 0 ? [...only] : [...withData]).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  if (columns.length === 0) throw new PrematchReportError("нет контор для отчёта", 400);
  const missing = columns.filter((s) => !withData.has(s));

  // контора, которая выкладывала матч, но сейчас линии у неё нет (для ещё не начавшегося матча) -> «-*» в последней таблице
  let staleNow = new Set<string>();
  if (!past) {
    const fresh = await prisma.bookmakerMatch.findMany({ where: { matchId, updatedAt: { gte: staleCutoff() } }, select: { bookmaker: { select: { slug: true } } } });
    const freshSet = new Set(fresh.map((f) => f.bookmaker.slug));
    staleNow = new Set(columns.filter((s) => withData.has(s) && !freshSet.has(s)));
  }

  // склейка снимков в моменты и отбор: новый момент
  type Frame = { at: Date; state: Record<string, Cell> };
  const collect = (threshold: number) => {
    const state: Record<string, Cell> = {};
    let shown: Record<string, Cell> = {};
    const snap = (): Record<string, Cell> => Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { ...v }]));
    const frames: Frame[] = [];
    let i = 0;
    while (i < rows.length) {
      const start = rows[i].at.getTime();
      let last = rows[i].at;
      while (i < rows.length && rows[i].at.getTime() - start < BUCKET_MS) {
        const r = rows[i];
        (state[r.slug] ??= {})[r.outcome as Outcome] = r.price;
        last = r.at;
        i++;
      }
      const moved = (() => {
        if (frames.length === 0) return true;
        for (const slug of columns) {
          const cur = state[slug];
          if (!cur) continue;
          const prev = shown[slug] ?? {};
          for (const [o] of outcomes) {
            const c = cur[o];
            if (c == null) continue;
            const p = prev[o];
            if (p == null || Math.abs(c - p) / p >= threshold) return true;
          }
        }
        return false;
      })();
      if (moved) {
        frames.push({ at: last, state: snap() });
        shown = snap();
      }
    }
    return { frames, shown, finalState: snap() };
  };
  let threshold = PREMATCH_THRESHOLDS[0];
  let res = collect(threshold);
  for (const t of PREMATCH_THRESHOLDS.slice(1)) {
    if (res.frames.length <= MAX_MOMENTS) break;
    threshold = t;
    res = collect(threshold);
  }
  const { frames, shown, finalState } = res;
  const thrPct = Math.round(threshold * 100);
  // итог «перед стартом / сейчас»: если после последней показанной таблицы кэфы ещё менялись (меньше порога)
  const lastRowAt = rows[rows.length - 1].at;
  let tail = "";
  const differs = columns.some((slug) => outcomes.some(([o]) => (finalState[slug]?.[o] ?? null) !== (shown[slug]?.[o] ?? null)));
  if (differs || frames.length === 1) {
    if (differs) frames.push({ at: past ? lastRowAt : end, state: finalState });
  } else {
    tail = ` · без изменений до ${fmtMsk(past ? lastRowAt : end)}`;
  }

  const kick = match.kickoffAt.getTime();
  const lastIdx = frames.length - 1;
  const moments: PrematchMoment[] = frames.map((f, idx) => {
    const prices: Prices = {};
    for (const slug of columns) {
      const c = f.state[slug];
      const hasAny = c && outcomes.some(([o]) => c[o] != null);
      prices[prettyKey(slug)] = hasAny ? { "1": c["1"] ?? null, X: c.X ?? null, "2": c["2"] ?? null } : null;
    }
    const unav = idx === lastIdx ? [...staleNow].map(prettyKey) : [];
    for (const n of unav) prices[n] = null;
    let label = `${fmtMsk(f.at)} МСК · за ${lead(kick - f.at.getTime())} до начала`;
    if (idx === 0) label = `Открытие линии · ${label}`;
    else if (idx === lastIdx && frames.length > 1) label = `${past ? "Перед стартом" : "Сейчас"} · ${label}`;
    if (idx === lastIdx && tail) label += tail;
    return { time: label, isGoal: false, goalTeam: null, matchMinute: null, scoreHome: null, scoreAway: null, prices, unavailableNow: unav };
  });
  function prettyKey(slug: string) {
    return prematchBookName(slug);
  }

  // автоматические выводы вместо ИИ-сводки
  const names = columns.map(prettyKey);
  const bestOf = (m: PrematchMoment, o: Outcome) => {
    let best: { v: number; book: string } | null = null;
    for (const n of names) {
      const v = m.prices[n]?.[o];
      if (v != null && (!best || v > best.v)) best = { v, book: n };
    }
    return best;
  };
  const first = moments[0];
  const last = moments[moments.length - 1];
  const lines: string[] = [];
  lines.push(
    `Линия открылась ${fmtMsk(frames[0].at)} МСК (за ${lead(kick - frames[0].at.getTime())} до начала). В отчёте ${moments.length} ${moments.length === 1 ? "таблица" : "таблиц"}: ` +
      `новая добавляется, когда кэф любой конторы сдвигается на ${thrPct}% и больше от последнего показанного. Записей в базе: ${rows.length}.` +
      (threshold > PREMATCH_THRESHOLDS[0] ? ` Порог поднят с 1% до ${thrPct}%: при 1% таблиц было бы больше ${MAX_MOMENTS}.` : "")
  );
  if (moments.length > 1) {
    const parts = outcomes.map(([o, lab]) => {
      const a = bestOf(first, o);
      const b = bestOf(last, o);
      return a && b ? `${lab} ${a.v.toFixed(2)} (${esc(a.book)}) → ${b.v.toFixed(2)} (${esc(b.book)})` : null;
    }).filter(Boolean);
    if (parts.length) lines.push(`Лучшая цена, открытие → ${past ? "старт" : "сейчас"}: ${parts.join("; ")}.`);
    // самые большие сдвиги: первое известное значение конторы против последнего
    const moves: { name: string; lab: string; a: number; b: number; d: number }[] = [];
    for (const slug of columns) {
      const n = prettyKey(slug);
      for (const [o, lab] of outcomes) {
        const a = firstValue(slug, o);
        const b = finalState[slug]?.[o];
        if (a != null && b != null && a !== b) moves.push({ name: n, lab, a, b, d: pct(a, b) });
      }
    }
    moves.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    if (moves.length) {
      lines.push(
        "Сильнее всего сдвинулись: " +
          moves.slice(0, 3).map((m) => `${esc(m.name)} ${m.lab} ${m.a.toFixed(2)} → ${m.b.toFixed(2)} (${m.d > 0 ? "+" : ""}${m.d.toFixed(1)}%)`).join("; ") + "."
      );
    }
  }
  const spread = outcomes.map(([o, lab]) => {
    const vs = names.map((n) => last.prices[n]?.[o]).filter((v): v is number => v != null);
    if (vs.length < 2) return null;
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return `${lab} ${lo.toFixed(2)}–${hi.toFixed(2)} (разница ${pct(lo, hi).toFixed(1)}%)`;
  }).filter(Boolean);
  if (spread.length) lines.push(`Разброс между конторами ${past ? "перед стартом" : "сейчас"}: ${spread.join("; ")}.`);
  if (missing.length) lines.push(`Нет данных по этому матчу: ${missing.map((s) => esc(prettyKey(s))).join(", ")}.`);

  function firstValue(slug: string, o: Outcome): number | null {
    for (const f of frames) {
      const v = f.state[slug]?.[o];
      if (v != null) return v;
    }
    return null;
  }

  const leadNow = past ? "матч начался, линия закрыта" : `до начала ${lead(kick - now.getTime())}`;
  return {
    match: {
      home: match.homeTeam,
      away: match.awayTeam,
      sport: ({ football: "Футбол", hockey: "Хоккей", tennis: "Теннис" } as Record<string, string>)[sportSlug] ?? match.league.sport.name,
      league: match.league.name,
      prematch: true,
      thresholdPct: thrPct,
      kickoff: fmtMsk(match.kickoffAt, true) + " (МСК)",
      live: false,
      infoRows: [
        ["Начало матча", fmtMsk(match.kickoffAt, true) + " (МСК)", "Статус", leadNow],
        ["Отчёт сформирован", fmtMsk(now, true) + " (МСК)", "Порог", `новая таблица при сдвиге кэфа от ${thrPct}%`],
        ["Данные с", fmtMsk(rows[0].at, true) + " (МСК)", "Конторы", names.join(", ")],
      ],
      summaryTitle: "СВОДКА ПО ДВИЖЕНИЮ",
      aiSummary: lines.join("<br/>"),
      dashNote: "«—» — контора не выкладывала этот матч на этот момент или её данных по нему нет.",
      starNote: staleNow.size
        ? "<b>—*</b> — контора выкладывала матч раньше, но сейчас линии у неё нет (снята или давно не обновлялась)."
        : null,
      footer: "Betmark — отчёт по прематч-коэффициентам",
    },
    bookmakers: names,
    moments,
    outcomes: outcomes.map(([o, lab]) => [o, lab]),
  };
}
