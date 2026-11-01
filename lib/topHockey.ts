// Классификация "топ-лига хоккея или нет" - аналог lib/topLeagues.ts (футбол) и lib/topTennis.ts (теннис)
const HOCKEY_NOISE_RE =
  /товарищ|nhl\s*2[4-9]\b|шорт-хоккей|до\s*\d+\s*лет|молод|юниор|junior|nuorten|резерв|новичк|3x[0-9]|2x[0-9]/i;

export function isTopHockeyLeague(leagueName: string): boolean {
  const l = leagueName.toLowerCase();
  if (HOCKEY_NOISE_RE.test(l)) return false;
  const isKHL = /кхл/.test(l);
  const isNHL = /нхл|\bnhl\b/.test(l);
  return isKHL || isNHL;
}

const NHL_PRESEASON_RE = /предсезон/i;

export function topHockeyKey(leagueName: string): string | null {
  const l = leagueName.toLowerCase();
  if (HOCKEY_NOISE_RE.test(l)) return null;
  if (/кхл/.test(l)) return "КХЛ";
  if (/нхл|\bnhl\b/.test(l)) {
    return NHL_PRESEASON_RE.test(l) ? "НХЛ (предсезон)" : "НХЛ";
  }
  return null;
}

export const TOP_HOCKEY_NAMES = ["КХЛ", "НХЛ", "НХЛ (предсезон)"];

const REAL_NHL_TEAM_STEMS = [
  "анахайм", "бостон", "баффало", "буффало", "калгари", "каролина", "чикаго", "колорадо",
  "коламбус", "даллас", "детройт", "эдмонтон", "флорида", "лос-андж", "лос анж",
  "миннесота", "монреаль", "нэшвилл", "нашвилл", "нью-джерси", "нью джерси",
  "айлендерс", "рейнджерс", "оттава", "филадельфия", "питтсбург", "сан-хосе",
  "сан хосе", "сиэтл", "сент-луис", "сент луис", "тампа", "торонто", "юта",
  "ванкувер", "вегас", "вашингтон", "виннипег",
];

function looksLikeRealNhlTeam(name: string): boolean {
  const n = name.toLowerCase();
  return REAL_NHL_TEAM_STEMS.some((stem) => n.includes(stem));
}

const NHL_REGULAR_SEASON_START = new Date("2026-10-01T00:00:00Z");

const MULTI_BOOKMAKER_THRESHOLD = 2;

// Вызывается ТОЛЬКО когда лига уже классифицирована как НХЛ (topHockeyKey
export function isFakeNhlMatch(m: { homeTeam: string; awayTeam: string; league: string; kickoffAt: string | Date; bookmakerCount?: number }): boolean {
  if (topHockeyKey(m.league) !== "НХЛ") return false;
  const kickoff = typeof m.kickoffAt === "string" ? new Date(m.kickoffAt) : m.kickoffAt;
  if (kickoff < NHL_REGULAR_SEASON_START) {
    const hasRealTeam = looksLikeRealNhlTeam(m.homeTeam) || looksLikeRealNhlTeam(m.awayTeam);
    const confirmedByMultipleBookmakers = (m.bookmakerCount ?? 0) >= MULTI_BOOKMAKER_THRESHOLD;
    return !(hasRealTeam && confirmedByMultipleBookmakers);
  }
  return !looksLikeRealNhlTeam(m.homeTeam) || !looksLikeRealNhlTeam(m.awayTeam);
}
