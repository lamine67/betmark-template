// Заглушка коннектора (в публичном шаблоне парсеров нет)
import type { LiveOdds } from "./types";

// Крипто-конторы одной платформы: общая live-лента бренда по slug и id события
export async function fetchAlphaLiveOdds(_brandSlug: string, _eventId: string): Promise<LiveOdds | null> {
  return null;
}
