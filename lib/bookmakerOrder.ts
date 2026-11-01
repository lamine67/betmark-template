// Единый ФИКСИРОВАННЫЙ порядок контор на сайте "все бк должны быть статичны по порядку")
export const BOOKMAKER_ORDER: readonly string[] = [
  "bookq",
  "booka", "bookb", "bookc", "bookd", "booke", "bookf", "bookg", "bookh", "booki", "bookl", "bookj", "bookk",
  "bookm", "booko", "bookn", "bookp", "books", "bookr", "booku", "bookt",
];

export function bookmakerRank(slug: string): number {
  const i = BOOKMAKER_ORDER.indexOf(slug);
  return i === -1 ? 1000 : i;
}

export function compareBookmakerSlugs(a: string, b: string): number {
  return bookmakerRank(a) - bookmakerRank(b) || a.localeCompare(b);
}
