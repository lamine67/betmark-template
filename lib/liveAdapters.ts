// Общий список контор, у которых ЕСТЬ рабочий live-адаптер (проект, Live-трекер)
export const LIVE_ADAPTER_SLUGS = ["booka", "booke", "bookd", "bookb", "bookf", "bookc", "bookg", "bookh", "booki", "bookj", "bookk"] as const;
export type LiveAdapterSlug = (typeof LIVE_ADAPTER_SLUGS)[number];

export const LIVE_ADAPTER_DISPLAY: Record<LiveAdapterSlug, string> = {
  booka: "Book A",
  booke: "Book E",
  bookd: "Book D",
  bookb: "Book B",
  bookf: "Book F",
  bookc: "Book C",
  bookg: "Book G",
  bookh: "Book H",
  booki: "Book I",
  bookj: "Book J",
  bookk: "Book K",
};

export const MANDATORY_LIVE_ADAPTER: LiveAdapterSlug = "booka";

// Теннис live-трекер тенниса опрашивает только конторы
export const TENNIS_LIVE_ADAPTER_SLUGS: readonly string[] = ["booka", "bookg", "bookj", "booki"];

export function isLiveAdapterSlug(slug: string): slug is LiveAdapterSlug {
  return (LIVE_ADAPTER_SLUGS as readonly string[]).includes(slug);
}

export const LIVE_DETAIL_LEVELS = ["MAX", "MODERATE", "ULTRA", "STANDARD", "ECONOMY"] as const;
export type LiveDetailLevel = (typeof LIVE_DETAIL_LEVELS)[number];

export const STANDARD_CHANGE_THRESHOLD = 0.15;

// Раз во сколько секунд ULTRA прогоняет накопленное через ИИ
export const AI_CHECK_INTERVAL_SEC = 5 * 60;

export interface LiveDetailLevelConfig {
  label: string;
  pollIntervalSec: number;
  writeRule: "always" | "anyChange" | "threshold" | "goalOnly";
  description: string; // текст всплывающей подсказки при наведении
  costsMoney?: boolean; // задействует платный вызов ИИ-API - предупреждение в UI
}

export const LIVE_DETAIL_LEVEL_CONFIG: Record<LiveDetailLevel, LiveDetailLevelConfig> = {
  MAX: {
    label: "Максимально подробный",
    pollIntervalSec: 5,
    writeRule: "always",
    description:
      "Проверка каждые 5 секунд. Записывает коэффициент на КАЖДОМ опросе, даже если он не изменился - самый подробный вариант, но и самый большой отчёт.",
  },
  MODERATE: {
    label: "Умеренный",
    pollIntervalSec: 5,
    writeRule: "anyChange",
    description: "Проверка каждые 5 секунд. Записывает любое реальное изменение коэффициента, без порога.",
  },
  ULTRA: {
    label: "Ультра",
    pollIntervalSec: 15,
    writeRule: "anyChange",
    description:
      "Умеренная проверка (как «Умеренный» - раз в 15 секунд, пишет любое реальное изменение), но плюс ИИ каждые 5 минут ищет аномалии прямо во время слежки, не дожидаясь конца матча. Платно - каждая проверка это реальный вызов ИИ-API, стоит денег.",
    costsMoney: true,
  },
  STANDARD: {
    label: "Стандартный",
    pollIntervalSec: 30,
    writeRule: "threshold",
    description: `Проверка раз в 30 секунд. Записывает только серьёзные изменения коэффициента (±${STANDARD_CHANGE_THRESHOLD} и больше) - мелкие колебания игнорируются.`,
  },
  ECONOMY: {
    label: "Экономичный",
    pollIntervalSec: 30,
    writeRule: "goalOnly",
    description: "Проверка раз в 30 секунд, но в отчёт попадают коэффициенты ТОЛЬКО в моменты голов - минимум данных, только самое важное.",
  },
};

export const DEFAULT_LIVE_DETAIL_LEVEL: LiveDetailLevel = "MODERATE";

export function isLiveDetailLevel(value: string): value is LiveDetailLevel {
  return (LIVE_DETAIL_LEVELS as readonly string[]).includes(value);
}

// Крипто-версия
export const CRYPTO_LIVE_ADAPTER_SLUGS = ["bookm", "booko", "bookp", "books", "bookr", "booku", "bookt"] as const;
export type CryptoLiveAdapterSlug = (typeof CRYPTO_LIVE_ADAPTER_SLUGS)[number];

export const CRYPTO_LIVE_ADAPTER_DISPLAY: Record<CryptoLiveAdapterSlug, string> = {
  bookm: "Book M",
  booko: "Book O",
  bookp: "Book P",
  books: "Book S",
  bookr: "Book R",
  booku: "Book U",
  bookt: "Book T",
};

// Alpha-конторы - только они могут быть якорем (у Book R live-лента без времени матча и без хоккея)
export const CRYPTO_ANCHOR_ORDER = ["bookm", "booko", "bookp", "books", "booku", "bookt"] as const;
export const CRYPTO_MANDATORY_LIVE_ADAPTER = "bookm";

export function isCryptoLiveAdapterSlug(slug: string): slug is CryptoLiveAdapterSlug {
  return (CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[]).includes(slug);
}

// Якорь отслеживания хранится в LiveTracking.bookaEventId (имя поля историческое)
export type LiveAnchor = { kind: "booka"; id: string } | { kind: "alpha"; slug: string; id: string };

export function parseAnchor(value: string | null | undefined): LiveAnchor {
  const m = (value ?? "").match(/^alpha:([a-z0-9]+):(.+)$/);
  return m ? { kind: "alpha", slug: m[1], id: m[2] } : { kind: "booka", id: value ?? "" };
}

export function formatAlphaAnchor(slug: string, externalId: string): string {
  return `alpha:${slug}:${externalId}`;
}

export function isCryptoSiteHost(host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase();
  return h.startsWith("crypto.") || h.startsWith("krypto.");
}
