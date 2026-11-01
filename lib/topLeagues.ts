const TOP_LEAGUE_NOISE_RE =
  /статистик|резерв|молод|юнио|женщин|игрок|кибер|\(мол\)|u1[0-9]|u2[0-9]|до\s*\d+\s*(лет|года)|rfef|рфеф|группа|sfl|npl|истми|isthmian|афк|африк|\bcaf\b|северная|южная|восточная|западная|вторая|трет[ьи]|2-(й|я)|3-(й|я)|дивизион\s*[23]|лига\s*[23]\b|бундеслига\s*[23]\b|simulated|\bsrl\b|любител|кубок\s*премьер|примера\s*федерац|ставки\s*на|национальн/i;

export function isWomenMatch(m: { homeTeam: string; awayTeam: string; league: string }): boolean {
  return m.homeTeam.includes("(ж)") || m.awayTeam.includes("(ж)") || /женщин/i.test(m.league);
}

export function isTopLeague(leagueName: string): boolean {
  const l = leagueName.toLowerCase();
  const isAfcon = /кубок\s+африканских\s+наций/i.test(l) || /кубок\s+африки/i.test(l);
  if (isAfcon && !YOUTH_LEAGUE_RE.test(l) && !/\(мол\)/.test(l)) return true;
  if (TOP_LEAGUE_NOISE_RE.test(l)) return false;

  const isRPL = /росси/.test(l) && /премьер/.test(l);
  const isEnglandCountry = l.startsWith("англия") || l.startsWith("england");
  const isEPL = (isEnglandCountry && /премьер/.test(l)) || /апл/.test(l);
  const isSerieA = /итали/.test(l) && /серия\s*[aа]/.test(l);
  const isLaLiga = /ла\s*лига/.test(l) || (/испан/.test(l) && /примера/.test(l));
  const isLigue1 = /франц/.test(l) && /лига\s*1\b/.test(l);
  const isBundesliga = /бундеслиг/.test(l) && !/австри|швейцар/.test(l);
  const isPrimeiraLiga = /португал/.test(l) && /(примейра|премьер)/.test(l);
  // "лиг[а-яё]*" вместо "лига" - ловит падежные формы разных контор
  const isChampionsLeague = /лиг[а-яё]*\s*чемпионов/.test(l);
  const isEuropaLeague = /лиг[а-яё]*\s*европы/.test(l);
  const isConferenceLeague = /лиг[а-яё]*\s*конференци/.test(l);
  const isNationalTeamFriendly = /сборн/.test(l) && /товарищ/.test(l);
  const isNationsLeague = /лиг[а-яё]*\s*наций/.test(l) || /nations\s*league/i.test(l);

  return (
    isRPL ||
    isEPL ||
    isSerieA ||
    isLaLiga ||
    isLigue1 ||
    isBundesliga ||
    isPrimeiraLiga ||
    isChampionsLeague ||
    isEuropaLeague ||
    isConferenceLeague ||
    isNationalTeamFriendly ||
    isNationsLeague
  );
}

// Метка конкретной топ-лиги (не просто true/false)
export function topLeagueKey(leagueName: string): string | null {
  const l = leagueName.toLowerCase();
  const isAfconKey = /кубок\s+африканских\s+наций/i.test(l) || /кубок\s+африки/i.test(l);
  if (isAfconKey && !YOUTH_LEAGUE_RE.test(l) && !/\(мол\)/.test(l))
    return "Кубок Африканских Наций";
  if (TOP_LEAGUE_NOISE_RE.test(l)) return null;

  if (/росси/.test(l) && /премьер/.test(l)) return "РПЛ";
  const isEnglandCountry = l.startsWith("англия") || l.startsWith("england");
  if ((isEnglandCountry && /премьер/.test(l)) || /апл/.test(l)) return "АПЛ";
  if (/итали/.test(l) && /серия\s*[aа]/.test(l)) return "Серия A";
  if (/ла\s*лига/.test(l) || (/испан/.test(l) && /примера/.test(l))) return "Ла Лига";
  if (/франц/.test(l) && /лига\s*1\b/.test(l)) return "Лига 1";
  if (/бундеслиг/.test(l) && !/австри|швейцар/.test(l)) return "Бундеслига";
  if (/португал/.test(l) && /(примейра|премьер)/.test(l)) return "Примейра-лига";
  if (/лиг[а-яё]*\s*чемпионов/.test(l)) return "Лига чемпионов";
  if (/лиг[а-яё]*\s*европы/.test(l)) return "Лига Европы";
  if (/лиг[а-яё]*\s*конференци/.test(l)) return "Лига конференций";
  if (/сборн/.test(l) && /товарищ/.test(l)) return "Сборные. Товарищеские матчи";
  if (/лиг[а-яё]*\s*наций/.test(l) || /nations\s*league/i.test(l)) return "Лига наций";
  return null;
}

const AFRICAN_CONFEDERATION_RE = /африк|\bcaf\b/i;

// Найдено - "афк" в TOP_LEAGUE_NOISE_RE выше только исключает Азиатскую конфедерацию из топ-бакета "Лига чемпионов"
const ASIAN_CONFEDERATION_RE = /афк|\bafc\b|чемпионов\s*ази/i;

const YOUTH_LEAGUE_RE = /\bu-?1[0-9]\b|\bu-?2[0-9]\b|до\s*\d+\s*(лет|года)|молодёж|молодеж|юнио/i;

const VIRTUAL_OR_SPECIAL_LEAGUE_RE = /simulated|\bsrl\b|любител|ставки\s*на/i;
const PLAYER_PROP_LEAGUE_RE = /противостояние игроков|показатели игроков|кто забьет больше голов|статистика игрового дня/i;

// Полное скрытие с сайта (любой режим отображения)
export function isExcludedLeague(league: string): boolean {
  const l = league.toLowerCase();
  return AFRICAN_CONFEDERATION_RE.test(l) || ASIAN_CONFEDERATION_RE.test(l) || YOUTH_LEAGUE_RE.test(l) || PLAYER_PROP_LEAGUE_RE.test(l) || VIRTUAL_OR_SPECIAL_LEAGUE_RE.test(l);
}

export interface ClassificationExplanation {
  leagueName: string;
  isTop: boolean;
  topKey: string | null;
  isExcluded: boolean;
  excludedByWhat: string | null;
  excludedMatchedText: string | null;
  blockedByNoise: boolean;
  noiseMatchedText: string | null;
  summary: string;
}

export function explainClassification(leagueName: string): ClassificationExplanation {
  const l = leagueName.toLowerCase();

  const noiseMatch = TOP_LEAGUE_NOISE_RE.exec(l);
  const africanMatch = AFRICAN_CONFEDERATION_RE.exec(l);
  const asianMatch = ASIAN_CONFEDERATION_RE.exec(l);
  const youthMatch = YOUTH_LEAGUE_RE.exec(l);
  const playerPropMatch = PLAYER_PROP_LEAGUE_RE.exec(l);

  let excludedByWhat: string | null = null;
  let excludedMatchedText: string | null = null;
  if (africanMatch) {
    excludedByWhat = "AFRICAN_CONFEDERATION_RE (скрытие африканских турниров)";
    excludedMatchedText = africanMatch[0];
  } else if (asianMatch) {
    excludedByWhat = "ASIAN_CONFEDERATION_RE (скрытие азиатских турниров)";
    excludedMatchedText = asianMatch[0];
  } else if (youthMatch) {
    excludedByWhat = "YOUTH_LEAGUE_RE (скрытие молодёжных турниров)";
    excludedMatchedText = youthMatch[0];
  } else if (playerPropMatch) {
    excludedByWhat = "PLAYER_PROP_LEAGUE_RE (скрытие рынков игрок-против-игрока)";
    excludedMatchedText = playerPropMatch[0];
  }
  const isExcluded = excludedByWhat !== null;

  const topKey = topLeagueKey(leagueName);
  const isTop = topKey !== null;

  let summary: string;
  if (isExcluded) {
    summary =
      `Лига полностью скрыта с сайта - сработал ${excludedByWhat} в lib/topLeagues.ts (isExcludedLeague), ` +
      `совпало по тексту "${excludedMatchedText}" в названии "${leagueName}". Если это ложное срабатывание ` +
      `(лига реальная, просто содержит это слово по совпадению) - нужно сузить именно этот regex.`;
  } else if (isTop) {
    summary =
      `Лига корректно распознаётся как топ-лига "${topKey}" (lib/topLeagues.ts, topLeagueKey) - если её всё ` +
      `равно не видно на сайте, дело не в классификации лиги, а в чём-то другом (сбор данных, фильтр по спорту, ` +
      `дедупликация матча) - нужен отдельный разбор.`;
  } else if (noiseMatch) {
    summary =
      `Лига НЕ считается топ-лигой - в isTopLeague/topLeagueKey (lib/topLeagues.ts) первым делом сработал общий ` +
      `шумовой фильтр TOP_LEAGUE_NOISE_RE, совпало по тексту "${noiseMatch[0]}" в названии "${leagueName}". ` +
      `Если это ложное срабатывание (лига реально топовая, просто содержит это слово) - нужно сузить именно ` +
      `этот regex, не трогая остальные.`;
  } else {
    summary =
      `Лига "${leagueName}" не входит ни в одну из 13 узнаваемых топ-лиг (РПЛ/АПЛ/Серия A/Ла Лига/Лига 1/` +
      `Бундеслига/Примейра-лига/Лига чемпионов/Лига Европы/Лига конференций/Сборные. Товарищеские матчи/` +
      `Лига наций/Кубок Африканских Наций) - ни общий шумовой фильтр, ни ` +
      `конкретные проверки в isTopLeague (lib/topLeagues.ts) не сработали ни в одну, ни в другую сторону. Если ` +
      `эта лига должна быть топовой - нужно добавить для неё новую отдельную проверку в этот файл.`;
  }

  return {
    leagueName,
    isTop,
    topKey,
    isExcluded,
    excludedByWhat,
    excludedMatchedText,
    blockedByNoise: !!noiseMatch,
    noiseMatchedText: noiseMatch?.[0] ?? null,
    summary,
  };
}

export const TOP_LEAGUE_NAMES = [
  "РПЛ",
  "АПЛ",
  "Серия A",
  "Ла Лига",
  "Лига 1",
  "Бундеслига",
  "Примейра-лига",
  "Лига чемпионов",
  "Лига Европы",
  "Лига конференций",
  "Сборные. Товарищеские матчи",
  "Лига наций",
  "Кубок Африканских Наций",
];
