// Заглушка коннектора (в публичном шаблоне парсеров нет)
import type { LiveOdds } from "./types";

export async function fetchBookhLiveOdds(_externalId: string, _sportOrSnapshot?: unknown): Promise<LiveOdds | null> {
  return null;
}
