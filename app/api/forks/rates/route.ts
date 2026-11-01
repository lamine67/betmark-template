// Курсы валют для калькулятора вилок: ЦБ РФ (cbr-xml-daily.ru), кэш на час
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

let cache: { at: number; data: { rates: Record<string, number>; date: string | null } } | null = null;

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  if (!cache || Date.now() - cache.at > 3600_000) {
    try {
      const res = await fetch("https://example.com", { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      const j = (await res.json()) as { Date: string; Valute: Record<string, { Value: number; Nominal: number }> };
      const pick = (c: string) => (j.Valute[c] ? j.Valute[c].Value / j.Valute[c].Nominal : NaN);
      const rates: Record<string, number> = { RUB: 1, USD: pick("USD"), EUR: pick("EUR"), GBP: pick("GBP"), KZT: pick("KZT"), BYN: pick("BYN"), UAH: pick("UAH") };
      rates.USDT = rates.USD;
      rates.USDC = rates.USD;
      cache = { at: Date.now(), data: { rates, date: j.Date } };
    } catch {
      if (!cache) cache = { at: Date.now() - 3000_000, data: { rates: { RUB: 1 }, date: null } };
    }
  }
  return NextResponse.json(cache.data);
}
