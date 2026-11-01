// Кэш готовых ответов /api/matches
type Entry = { at: number; status: number; text: string };
interface Store {
  responseCache: Map<string, Entry>;
  inflight: Map<string, Promise<{ status: number; text: string }>>;
}
const g = globalThis as unknown as { __matchesCacheStore?: Store };
const store: Store = (g.__matchesCacheStore ??= { responseCache: new Map(), inflight: new Map() });

export const RESPONSE_TTL_MS = 30_000;
export const responseCache = store.responseCache;
export const inflight = store.inflight;

/** Без аргумента - сбросить всё (удаление "у всех"), с логином - только записи этого пользователя */
export function clearMatchesCache(username?: string): void {
  if (!username) {
    responseCache.clear();
    return;
  }
  for (const k of [...responseCache.keys()]) if (k.startsWith(username + "|")) responseCache.delete(k);
}
