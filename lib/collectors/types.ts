// Общие типы коннекторов

/** Матч в формате, который понимает syncRunner (lib/syncRunner.ts) */
export interface NormalizedMatch {
  externalId: string;
  sourceUrl?: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  leagueName: string;
  odds: { outcome: "1" | "X" | "2"; price: number }[];
}

/** Live-цены одного матча у одной конторы. null = матч у конторы сейчас не идёт или не найден */
export interface LiveOdds {
  place?: string | null;
  price1: number | null;
  priceX: number | null;
  price2: number | null;
  scoreHome: number | null;
  scoreAway: number | null;
  /** контора сама пометила цену как идущую с задержкой */
  delayed?: boolean;
  timerSeconds?: number | null;
  timerDirection?: number | null;
  scoreDetail?: string | null;
}

export class ConnectorNotConfigured extends Error {
  constructor(name: string) {
    super(`Коннектор «${name}» не подключён: это шаблон без парсеров. См. docs/CONNECTORS.md`);
  }
}
