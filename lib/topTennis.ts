// Классификация "топ-турнир тенниса или нет"
const TENNIS_NOISE_RE =
  /челленджер|challenger|квалификаци|итф|\bitf\b|world tennis|utr|юниор|junior|парн|(?<![а-яё])пары(?![а-яё])|doubles|u1[0-9]|u2[0-9]/i;

const GRAND_SLAM_RE =
  /us open|открытый чемпионат сша|australian open|открытый чемпионат австралии|roland garros|ролан гаррос|открытый чемпионат франции|french open|wimbledon|уимблдон/i;

// найдено вживую
const ATP_WTA_TOUR_RE = /\b(atp|wta)\b/i;

// Book B не даёт названия конкретных турниров тенниса вообще
const BARE_TOUR_RE = /^\s*(atp|wta)\s*$/i;

export function isTopTennisTournament(name: string): boolean {
  const l = name.toLowerCase();
  if (BARE_TOUR_RE.test(l)) return true;
  if (TENNIS_NOISE_RE.test(l)) return false;
  return GRAND_SLAM_RE.test(l) || ATP_WTA_TOUR_RE.test(l);
}

export function topTennisKey(name: string): string | null {
  const l = name.toLowerCase();
  if (BARE_TOUR_RE.test(l)) return "ATP/WTA (Book B)";
  if (TENNIS_NOISE_RE.test(l)) return null;
  if (/us open|открытый чемпионат сша/.test(l)) return "US Open";
  if (/australian open|открытый чемпионат австралии/.test(l)) return "Australian Open";
  if (/roland garros|ролан гаррос|открытый чемпионат франции|french open/.test(l)) return "Roland Garros";
  if (/wimbledon|уимблдон/.test(l)) return "Уимблдон";
  if (ATP_WTA_TOUR_RE.test(l)) return "ATP/WTA";
  return null;
}

// Канонический список для сайдбара "Топ-турниры"
export const TOP_TENNIS_NAMES = ["US Open", "Australian Open", "Roland Garros", "Уимблдон", "ATP/WTA"];
