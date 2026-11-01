const GEMINI_BASE_URL = process.env.AI_BASE_URL || "";
const GEMINI_API_KEY = process.env.AI_API_KEY || "";
const GEMINI_MODEL = process.env.AI_MODEL || "gemini-flash-lite-latest";

// («с пинаклом много проблем, в лайве неправильные кэфы»)
export const BOOKG_REJECT_DIFF = 0.08;
const SUSPECT_DIFF = 0.09; // порог, с которого зовём арбитра
const HARD_REJECT_DIFF = 0.15; // если арбитр недоступен: выше - отбрасываем, ниже - пропускаем
const CACHE_TTL_MS = 60_000;
const AI_TIMEOUT_MS = 8000;

export interface OddsTriple {
  price1: number;
  priceX: number | null;
  price2: number;
}

function normProbs(o: OddsTriple): number[] {
  const raw = [1 / o.price1, ...(o.priceX != null ? [1 / o.priceX] : []), 1 / o.price2];
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}

// Максимальная разница нормализованных вероятностей по исходам; null - сравнить нельзя (разное число исходов)
export function probDiff(a: OddsTriple, b: OddsTriple): number | null {
  if ((a.priceX == null) !== (b.priceX == null)) return null;
  const pa = normProbs(a);
  const pb = normProbs(b);
  return Math.max(...pa.map((v, i) => Math.abs(v - pb[i])));
}

const cache = new Map<string, { at: number; ok: boolean; reason: string }>();
const inflight = new Map<string, Promise<{ ok: boolean; reason: string }>>();

export interface SanityContext {
  trackingId: string;
  slug: string;
  sport: string;
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  minute: number | null;
  anchorSlug: string;
  anchor: OddsTriple;
  candidate: OddsTriple;
}

async function askGemini(ctx: SanityContext, diff: number): Promise<{ ok: boolean; reason: string } | null> {
  if (!GEMINI_BASE_URL || !GEMINI_API_KEY) return null;
  try {
    const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${GEMINI_API_KEY}` },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Ты проверяешь live-коэффициенты, которые наш парсер снял с сайта букмекера. Нужно понять, это РЕАЛЬНЫЙ рынок «исход матча» (П1/Х/П2 в основное время) " +
              "ПРИ ТЕКУЩЕМ СЧЁТЕ, или ошибка сбора. Типичные ошибки: взят другой рынок (кто забьёт следующий гол, тотал, фора), цены остались от прошлого " +
              "состояния матча (до гола / с другим счётом / прематч), перепутаны хозяева и гости. Тебе даны эталонные цены другой крупной конторы на тот же момент " +
              "и цены проверяемой. Небольшие расхождения между конторами (маржа, чуть разная скорость обновления) - НОРМА, это verdict ok. verdict wrong - только если " +
              "проверяемые цены явно не соответствуют счёту и минуте матча или похожи на другой рынок. Если сомневаешься - ok. " +
              'Верни ТОЛЬКО JSON {"verdict":"ok"|"wrong","reason":"коротко"}.',
          },
          {
            role: "user",
            content: JSON.stringify({
              sport: ctx.sport,
              match: `${ctx.home} - ${ctx.away}`,
              score: `${ctx.scoreHome}:${ctx.scoreAway}`,
              minute: ctx.minute,
              reference_bookmaker: ctx.anchorSlug,
              reference_odds_1X2: [ctx.anchor.price1, ctx.anchor.priceX, ctx.anchor.price2],
              checked_bookmaker: ctx.slug,
              checked_odds_1X2: [ctx.candidate.price1, ctx.candidate.priceX, ctx.candidate.price2],
              max_normalized_probability_gap: Number(diff.toFixed(3)),
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content.replace(/^```json\s*|```\s*$/g, "").trim());
    if (parsed?.verdict !== "ok" && parsed?.verdict !== "wrong") return null;
    return { ok: parsed.verdict === "ok", reason: String(parsed.reason ?? "") };
  } catch {
    return null;
  }
}

export async function validateLiveOdds(ctx: SanityContext): Promise<{ ok: boolean; reason: string }> {
  const diff = probDiff(ctx.anchor, ctx.candidate);
  if (ctx.slug === "bookg" && diff != null && diff >= BOOKG_REJECT_DIFF) {
    return { ok: false, reason: `расхождение ${diff.toFixed(2)} с ${ctx.anchorSlug}: у Book G отстаёт гостевой API` };
  }
  if (diff == null || diff < SUSPECT_DIFF) return { ok: true, reason: "" };
  const key = [ctx.trackingId, ctx.slug, ctx.scoreHome, ctx.scoreAway, ctx.candidate.price1, ctx.candidate.priceX, ctx.candidate.price2].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: hit.ok, reason: hit.reason };
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const verdict = (await askGemini(ctx, diff)) ?? (diff >= HARD_REJECT_DIFF ? { ok: false, reason: `расхождение ${diff.toFixed(2)} (арбитр недоступен)` } : { ok: true, reason: "" });
      cache.set(key, { at: Date.now(), ...verdict });
      if (cache.size > 2000) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_TTL_MS) cache.delete(k);
      return verdict;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
