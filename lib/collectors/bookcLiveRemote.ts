// Заглушка коннектора (в публичном шаблоне парсеров нет)
import type { LiveOdds } from "./types";

// Режим «цены присылает отдельная машина»: флаг-файл рядом с проектом; здесь всегда выключен
export function bookcRemoteMode(): boolean {
  return false;
}

export async function fetchBookcLiveOddsRemote(_externalId: string): Promise<LiveOdds | null> {
  return null;
}
