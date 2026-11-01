// общее правило "перевёрнуты ли команды" для lib/matching.ts и ai-dedup.ts

export const NAME_SURE = 80; // название уверенно совпало в одной ориентации
export const NAME_MARGIN = 15; // минимальный перевес этой ориентации над другой
export const NAME_LOW = 60; // ниже - названия не помогают (оба ниже 60 -> решают кэфы)
export const FLIP_MIN_D = 0.2; // расхождение "как есть" в вероятностях, начиная с которого вообще смотрим флип
export const FLIP_RATIO = 0.5; // после обмена 1 и 2 расхождение должно стать меньше половины

export type Odds = { "1"?: number; X?: number; "2"?: number };
export type Probs = Partial<Record<"1" | "X" | "2", number>>;
const KEYS = ["1", "X", "2"] as const;

// q_i = (1/price_i) / сумма(1/price) - вероятности без маржи. null, если нет "1" или "2" или цена <= 1
export function normProbs(o: Odds | null | undefined): Probs | null {
  if (!o || o["1"] === undefined || o["2"] === undefined) return null;
  const keys = KEYS.filter((k) => o[k] !== undefined);
  if (keys.some((k) => !(o[k]! > 1))) return null;
  const sum = keys.reduce((s, k) => s + 1 / o[k]!, 0);
  return Object.fromEntries(keys.map((k) => [k, 1 / o[k]! / sum])) as Probs;
}

// Наибольшая разница вероятностей по общим исходам
export function gap(a: Probs, b: Probs): number {
  let m = 0;
  for (const k of KEYS) if (a[k] !== undefined && b[k] !== undefined) m = Math.max(m, Math.abs(a[k]! - b[k]!));
  return m;
}

export function flipOdds(o: Odds): Odds {
  const r: Odds = { ...o };
  delete r["1"];
  delete r["2"];
  if (o["2"] !== undefined) r["1"] = o["2"];
  if (o["1"] !== undefined) r["2"] = o["1"];
  return r;
}

// Медиана вероятностей без маржи по каждому исходу у других контор, затем снова нормировка. null, если не из чего
export function consensus(list: Odds[]): Probs | null {
  const ps = list.map(normProbs).filter(Boolean) as Probs[];
  if (!ps.length) return null;
  const med = (v: number[]) => {
    const s = [...v].sort((x, y) => x - y);
    const h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const out: Probs = {};
  for (const k of KEYS) {
    const vals = ps.map((p) => p[k]).filter((v) => v !== undefined) as number[];
    if (vals.length) out[k] = med(vals);
  }
  const sum = KEYS.reduce((s, k) => s + (out[k] ?? 0), 0);
  if (!(sum > 0) || out["1"] === undefined || out["2"] === undefined) return null;
  for (const k of KEYS) if (out[k] !== undefined) out[k] = out[k]! / sum;
  return out;
}

// Флип-тест: d - расхождение как есть, f - после обмена 1 и 2
export function flipTestDetails(own: Odds | null | undefined, cons: Probs | null): { d: number; f: number; reversed: boolean } | null {
  const p = normProbs(own);
  const pf = own ? normProbs(flipOdds(own)) : null;
  if (!p || !pf || !cons) return null;
  const d = gap(p, cons);
  const f = gap(pf, cons);
  return { d, f, reversed: d > FLIP_MIN_D && f < FLIP_RATIO * d };
}

export function flipTest(own: Odds | null | undefined, cons: Probs | null): boolean {
  return flipTestDetails(own, cons)?.reversed ?? false;
}

// direct/swapped - token_set_ratio (MIN по двум сторонам) прямой и перевёрнутой ориентации. own
export function decideReversed(direct: number, swapped: number, own?: Odds | null, others?: Odds[]): boolean {
  if (swapped >= NAME_SURE && swapped - direct >= NAME_MARGIN) {
    // вето кэфов. token_set_ratio даёт 100 при вхождении одного названия в другое
    if (own && others && others.length) {
      const cons = consensus(others);
      const p = normProbs(own);
      const pf = normProbs(flipOdds(own));
      if (cons && p && pf && gap(p, cons) < 0.09 && gap(pf, cons) - gap(p, cons) >= 0.1) return false;
    }
    return true;
  }
  if (direct >= NAME_SURE && direct - swapped >= NAME_MARGIN) return false;
  if (!own || !others || !others.length) return false;
  return flipTest(own, consensus(others));
}

// Сырые кэфы сборщика ([{outcome, price}]) -> Odds
export function oddsFromList(list: { outcome: string; price: number }[] | undefined): Odds | null {
  if (!list) return null;
  const o: Odds = {};
  for (const x of list) if (x.outcome === "1" || x.outcome === "X" || x.outcome === "2") o[x.outcome] = x.price;
  return o["1"] !== undefined && o["2"] !== undefined ? o : null;
}
