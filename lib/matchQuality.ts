
export type MatchTag = "cyber" | "youth" | "reserve" | "lower" | "friendly" | "unknown" | "exotic";

export const MATCH_TAGS: { tag: MatchTag; label: string }[] = [
  { tag: "lower", label: "Низшие дивизионы и региональные лиги" },
  { tag: "exotic", label: "Малые футбольные страны (Африка, Азия, Океания, Центральная Америка)" },
  { tag: "youth", label: "Молодёжные, юниорские и студенческие" },
  { tag: "reserve", label: "Резервные и вторые составы" },
  { tag: "friendly", label: "Клубные товарищеские" },
  { tag: "cyber", label: "Киберспорт и симуляции" },
  { tag: "unknown", label: "Лига не определена" },
];

// По умолчанию всё перечисленное скрыто, а на матче должно быть не меньше 3 контор с кэфами
export const DEFAULT_HIDDEN_TAGS: MatchTag[] = MATCH_TAGS.map((t) => t.tag);
export const DEFAULT_MIN_BOOKS = 3;

// В JS-регэкспах \b не видит кириллицу как буквы, поэтому границы слов здесь - явные (?<![...]) / (?![...])
const L = "(?<![а-яёa-z0-9])";
const R = "(?![а-яёa-z0-9])";
const re = (src: string) => new RegExp(src.replaceAll("<", L).replaceAll(">", R), "i");

const CYBER_RE = re(String.raw`кибер|cyber|e-?sport|ea\s*sports|<fifa>|efootball|эфутбол|<h2h>|хоккейбол|simulated|<srl>|виртуальн|матчи\s*\d+\s*минут`);
const UNKNOWN_RE = /^\s*$|неизвестн|unknown/i;
const YOUTH_RE = re(
  String.raw`<u-?(1[0-9]|2[0-3])>|до\s*(1[0-9]|2[0-3])>|молод[её]ж|юниор|юнош|junior|juvenil|youth|примавер|primavera|<ncaa>|студен|<qmjhl>|<ohl>|<whl>|<ushl>|<н?мхл>|<jr>`
);
const RESERVE_LEAGUE_RE = /резерв|дубл|reserve/i;
const RESERVE_TEAM_RE = re(String.raw`\((р|рез|мол)\)|резерв|[\s-](ii|2|b|б)$|\sii\s|-2$`);
const FRIENDLY_RE = re(String.raw`клуб[а-яё]*\s*товарищ|товарищеск[а-яё]*\s*(матчи\s*)?клуб|club\s*friendl|friendlies\s*club`);
// Ниже высшего дивизиона страны
const LOWER_RE = re(
  [
    String.raw`<[2-9]-?(я|й|ая|ой)\s*(лига|дивизион|бундеслига)>`,
    String.raw`<лига\s*[2-9]>`, String.raw`<liga\s*[2-9]>`, String.raw`<[2-9]\.?\s*(liga|league|division|lig|bundesliga)>`, String.raw`<bundesliga\s*2>`,
    String.raw`<дивизион\s*[2-9]>`, String.raw`<division\s*[2-9]>`, String.raw`<(ii|iii|iv)\s*(liga|лига)>`,
    String.raw`<вторая>`, String.raw`<третья>`, String.raw`<четв[её]ртая>`, String.raw`second\s*(division|league)`, String.raw`<third>`,
    String.raw`tercera`, String.raw`терсера`, String.raw`segunda`, String.raw`сегунда`, String.raw`<serie\s*[cd]>`, String.raw`<серия\s*[cdсд]>`,
    String.raw`regional`, String.raw`регионал`, String.raw`ландеслига`, String.raw`landesliga`, String.raw`оберлига`, String.raw`oberliga`,
    String.raw`<северн`, String.raw`<южн`, String.raw`<восточн`, String.raw`<западн`, String.raw`истми`, String.raw`isthmian`, String.raw`non-?league`, String.raw`любител`, String.raw`amateur`, String.raw`<npl>`, String.raw`<sfl>`,
    String.raw`rfef`, String.raw`рфеф`, String.raw`<примера\s*(b|в)>`, String.raw`<primera\s*b>`, String.raw`насьональ`, String.raw`nacional\s*b`,
    String.raw`mestis`, String.raw`местис`, String.raw`hockeyettan`, String.raw`хоккейэттан`, String.raw`swiss\s*league`, String.raw`суисс\s*лига`, String.raw`швейцарская\s*лига`,
    String.raw`<(2nd|3rd|4th|5th)\s*div`, String.raw`<nb\s*(ii|iii)>`, String.raw`<[2-9]\.\s*дивизион`, String.raw`<[2-9]\.\s*snl>`,
    String.raw`<дивизион\s*б>`, String.raw`<(ii|iii)\s*division>`, String.raw`<[2-9]\s*$`, String.raw`<b\s*$`,
  ].join(String.raw`|`)
);
// Второй уровень, названный "первым"
const SECOND_TIER_RE = re(
  [
    String.raw`<1-?(я|й)\s*(лига|дивизион)>`, String.raw`<первая\s*лига>`, String.raw`<первый\s*дивизион>`, String.raw`<first\s*(league|division)>`,
    String.raw`<1st\s*div`, String.raw`<1\.\s*(liga|лига)>`, String.raw`<чемпионшип>`, String.raw`<championship>`, String.raw`<efl>`,
    String.raw`<серия\s*[bв]\d?>`, String.raw`<serie\s*b\d?>`, String.raw`<суперэттан>`, String.raw`<superettan>`, String.raw`<[bв][1-3]>`,
    String.raw`<tdp>`, String.raw`<premier\s*a>`, String.raw`<liga\s*premier>`, String.raw`<лига\s*премьер>`,
  ].join("|")
);
const FIRST_IS_TOP = new Set([
  "хорватия", "croatia", "чехия", "czech republic", "словения", "slovenia", "кипр", "cyprus", "болгария", "bulgaria",
  "бельгия", "belgium", "сан-марино", "san marino",
]);

// Теннис ниже ATP/WTA: челленджеры, ITF (W15-W100/M15-M25), UTR
const TENNIS_LOWER_RE = re(
  String.raw`challenger|челленджер|<itf>|futures|<utr>|мировой\s*теннис|world\s*tennis|<[wm](15|25|35|50|75|100)>`
);

// "Национальная лига" - 5-й уровень в Англии и 3-й во Франции
const NATIONAL_LOWER_RE = /^(англия|франция|england|france)\.\s*(национальн|national)/i;

// Малые футбольные страны: кэфы на них обычно у 1-2 контор, на доске по умолчанию не нужны
const EXOTIC_COUNTRIES = new Set([
  "уганда", "кения", "танзания", "нигерия", "гана", "эфиопия", "замбия", "зимбабве", "руанда", "бурунди", "малави", "ботсвана", "юар",
  "египет", "марокко", "алжир", "тунис", "камерун", "сенегал", "кот-д'ивуар", "кот-д’ивуар", "мали", "буркина-фасо", "гвинея", "либерия",
  "сьерра-Book D", "того", "бенин", "нигер", "чад", "судан", "сомали", "ангола", "мозамбик", "намибия", "лесото", "эсватини", "мадагаскар",
  "маврикий", "габон", "конго", "др конго", "ливия", "гамбия", "мавритания", "эритрея", "джибути",
  "uganda", "kenya", "tanzania", "nigeria", "ghana", "ethiopia", "zambia", "zimbabwe", "rwanda", "burundi", "malawi", "botswana",
  "south africa", "egypt", "morocco", "algeria", "tunisia", "cameroon", "senegal", "ivory coast", "angola", "mozambique", "namibia",
  "бангладеш", "индия", "индонезия", "вьетнам", "таиланд", "малайзия", "мьянма", "камбоджа", "лаос", "непал", "шри-ланка",
  "пакистан", "филиппины", "сингапур", "гонконг", "макао", "тайвань", "монголия", "бутан", "мальдивы", "ирак", "иордания",
  "сирия", "ливан", "палестина", "кувейт", "бахрейн", "оман", "йемен", "таджикистан", "туркменистан", "кыргызстан", "киргизия",
  "bangladesh", "india", "indonesia", "vietnam", "thailand", "malaysia", "myanmar", "cambodia", "laos", "nepal", "sri lanka",
  "pakistan", "philippines", "singapore", "hong kong", "taiwan", "mongolia", "bhutan", "maldives", "iraq", "jordan", "syria",
  "lebanon", "palestine", "kuwait", "bahrain", "oman", "yemen", "tajikistan", "turkmenistan", "kyrgyzstan",
  "гондурас", "гватемала", "сальвадор", "никарагуа", "коста-рика", "панама", "белиз", "ямайка", "тринидад и тобаго", "гаити",
  "доминиканская республика", "куба", "барбадос", "бермуды", "кюрасао", "пуэрто-рико",
  "honduras", "guatemala", "el salvador", "nicaragua", "costa rica", "panama", "belize", "jamaica", "trinidad and tobago", "haiti",
  "южная африка", "сан-марино", "san marino", "андорра", "andorra", "гибралтар", "gibraltar", "фарерские острова", "faroe islands", "лихтенштейн", "узбекистан", "фиджи", "новая каледония", "таити", "папуа - новая гвинея", "самоа", "тонга", "вануату", "соломоновы острова", "fiji",
]);

function splitLeague(league: string): { country: string; rest: string } {
  for (const sep of [". ", " - "]) {
    const i = league.indexOf(sep);
    if (i > 0) return { country: league.slice(0, i).trim().toLowerCase(), rest: league.slice(i + sep.length) };
  }
  // Без разделителя ("Буркина-Фасо") лига - это и есть страна
  return { country: league.trim().toLowerCase(), rest: league };
}

export function matchTags(m: { league: string; homeTeam: string; awayTeam: string }): MatchTag[] {
  const league = m.league ?? "";
  const home = (m.homeTeam ?? "").trim();
  const away = (m.awayTeam ?? "").trim();
  const { country, rest } = splitLeague(league);
  const tags: MatchTag[] = [];
  if (UNKNOWN_RE.test(league)) tags.push("unknown");
  if (CYBER_RE.test(league)) tags.push("cyber");
  if (YOUTH_RE.test(league) || YOUTH_RE.test(home) || YOUTH_RE.test(away)) tags.push("youth");
  if (RESERVE_LEAGUE_RE.test(league) || RESERVE_TEAM_RE.test(home) || RESERVE_TEAM_RE.test(away)) tags.push("reserve");
  if (FRIENDLY_RE.test(league)) tags.push("friendly");
  if (LOWER_RE.test(rest) || NATIONAL_LOWER_RE.test(league) || (SECOND_TIER_RE.test(rest) && !FIRST_IS_TOP.has(country)) || TENNIS_LOWER_RE.test(league)) tags.push("lower");
  if (country && EXOTIC_COUNTRIES.has(country)) tags.push("exotic");
  return tags;
}

// Сколько контор реально дают кэф на матч
export function booksWithOdds(
  bookmakers: { slug: string; odds: Record<string, number | null> }[],
  visibleSlugs?: Set<string>
): number {
  let n = 0;
  for (const b of bookmakers) {
    if (visibleSlugs && !visibleSlugs.has(b.slug)) continue;
    if (Object.values(b.odds).some((v) => typeof v === "number" && v > 1)) n++;
  }
  return n;
}

export function isHiddenByQuality(
  m: { league: string; homeTeam: string; awayTeam: string },
  hidden: ReadonlySet<MatchTag>
): boolean {
  if (hidden.size === 0) return false;
  return matchTags(m).some((t) => hidden.has(t));
}

export interface BoardPrefs {
  minBooks: number;
  hiddenTags: MatchTag[];
  timeWindow?: string;
}

export function normalizeBoardPrefs(raw: unknown): BoardPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const known = new Set<string>(MATCH_TAGS.map((t) => t.tag));
  const minBooks = typeof r.minBooks === "number" && r.minBooks >= 1 && r.minBooks <= 10 ? Math.floor(r.minBooks) : DEFAULT_MIN_BOOKS;
  const hiddenTags = Array.isArray(r.hiddenTags) ? (r.hiddenTags.filter((t) => typeof t === "string" && known.has(t)) as MatchTag[]) : DEFAULT_HIDDEN_TAGS;
  const timeWindow = typeof r.timeWindow === "string" && /^(\d{1,3}|all)$/.test(r.timeWindow) ? r.timeWindow : undefined;
  return { minBooks, hiddenTags, timeWindow };
}
