// Демо-коннектор: придуманные команды и цены, чтобы шаблон ожил без единой реальной конторы
import type { NormalizedMatch } from "./types";

const FIXTURES: { league: string; home: string; away: string; hoursAhead: number }[] = [
  { league: "Россия. Премьер-Лига", home: "Северный Город", away: "Речной Порт", hoursAhead: 2 },
  { league: "Россия. Премьер-Лига", home: "Заря Востока", away: "Металлург Юга", hoursAhead: 3 },
  { league: "Россия. Премьер-Лига", home: "Динамо Озёр", away: "Красная Гора", hoursAhead: 5 },
  { league: "Англия. АПЛ", home: "Лондонские Лисы", away: "Манчестерские Ткачи", hoursAhead: 2 },
  { league: "Англия. АПЛ", home: "Ливерпульские Чайки", away: "Бирмингемские Львы", hoursAhead: 4 },
  { league: "Англия. АПЛ", home: "Северные Волки", away: "Южные Орлы", hoursAhead: 6 },
  { league: "Германия. Бундеслига", home: "Рейн Юнайтед", away: "Бавария Альпийская", hoursAhead: 3 },
  { league: "Германия. Бундеслига", home: "Гамбургские Якоря", away: "Берлинские Медведи", hoursAhead: 7 },
  { league: "Испания. Примера Дивизион", home: "Севильские Апельсины", away: "Валенсийские Ветры", hoursAhead: 4 },
  { league: "Испания. Примера Дивизион", home: "Барсельские Маяки", away: "Мадридские Короли", hoursAhead: 8 },
  { league: "Италия. Серия A", home: "Туринские Зебры", away: "Миланские Дьяволы", hoursAhead: 5 },
  { league: "Франция. Лига 1", home: "Марсельские Порты", away: "Парижские Башни", hoursAhead: 9 },
];

// Небольшой детерминированный генератор: один и тот же вход даёт одно и то же число
function rnd(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function priceTriple(slug: string, key: string, bucket: number): [number, number, number] {
  // «истинные» вероятности матча (одинаковы у всех контор), потом у каждой конторы своя маржа и шум
  const a = 0.25 + rnd("a" + key) * 0.4;
  const d = 0.2 + rnd("d" + key) * 0.12;
  const b = Math.max(0.08, 1 - a - d);
  const sum = a + d + b;
  const margin = 1.04 + rnd("m" + slug) * 0.03;
  const f = (p: number, o: string) => {
    const noise = 1 + (rnd(slug + key + o + bucket) - 0.5) * 0.05;
    return Math.max(1.05, Math.round((1 / ((p / sum) * margin)) * noise * 100) / 100);
  };
  return [f(a, "1"), f(d, "X"), f(b, "2")];
}

/** Матчи футбола у демо-конторы slug (booka ... bookd) */
export async function collectDemoFootball(slug: string): Promise<NormalizedMatch[]> {
  const bucket = Math.floor(Date.now() / 60000);
  const day = new Date();
  day.setUTCMinutes(0, 0, 0);
  const alias = slug === "bookc"; // у третьей «конторы» другое написание названий: показывает, как работает склейка матчей
  return FIXTURES.map((f, i) => {
    const key = `${f.league}|${f.home}|${f.away}`;
    const [p1, px, p2] = priceTriple(slug, key, bucket);
    return {
      externalId: `${slug}-${i + 1}`,
      sourceUrl: null,
      homeTeam: alias ? `ФК ${f.home}` : f.home,
      awayTeam: alias ? `ФК ${f.away}` : f.away,
      kickoffAt: new Date(day.getTime() + f.hoursAhead * 3600_000),
      leagueName: f.league,
      odds: [
        { outcome: "1", price: p1 },
        { outcome: "X", price: px },
        { outcome: "2", price: p2 },
      ],
    };
  });
}
