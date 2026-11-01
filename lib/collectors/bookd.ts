// Заглушка коннектора (в публичном шаблоне парсеров нет)
export async function verifyLeagueUrl(_url: string): Promise<{ leagueName: string; matchesFound: number }> {
  return { leagueName: "", matchesFound: 0 };
}
