// Заглушка коннектора (в публичном шаблоне парсеров нет)
export async function verifyLeagueTarget(_country: string, _league: string): Promise<{ matchesFound: number }> {
  return { matchesFound: 0 };
}
