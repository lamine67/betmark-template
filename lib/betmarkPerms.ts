import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "./session";
import { BETMARK_PERM_KEYS, type BetmarkPermKey, type BetmarkPerms } from "./betmarkPermKeys";
import { usesExternalAuth, localAdminName } from "./localAuth";

export { BETMARK_PERM_KEYS, type BetmarkPermKey, type BetmarkPerms };

export interface BetmarkPermsResult {
  hasAccess: boolean;
  disabled: boolean;
  isAdmin: boolean;
  perms: BetmarkPerms;
}

function allFalsePerms(): BetmarkPerms {
  return Object.fromEntries(BETMARK_PERM_KEYS.map((k) => [k, false])) as BetmarkPerms;
}

const DENIED_RESULT: BetmarkPermsResult = { hasAccess: false, disabled: true, isAdmin: false, perms: allFalsePerms() };

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { data: BetmarkPermsResult; expiresAt: number }>();

async function fetchPermsFromWebpanel(username: string): Promise<BetmarkPermsResult> {
  if (!usesExternalAuth()) {
    // автономный режим: единственный администратор из ADMIN_USER получает все права, остальные имена - отказ
    if (username !== localAdminName()) return DENIED_RESULT;
    const perms = Object.fromEntries(BETMARK_PERM_KEYS.map((k) => [k, true])) as BetmarkPerms;
    return { hasAccess: true, disabled: false, isAdmin: true, perms };
  }
  const base = process.env.WEBPANEL_INTERNAL_URL;
  const token = process.env.INTERNAL_API_TOKEN;
  try {
    const res = await fetch(`${base}/api/internal/betmark-perms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": token || "" },
      body: JSON.stringify({ username }),
      cache: "no-store",
    });
    if (!res.ok) return DENIED_RESULT;
    const data = await res.json();
    const perms = { ...allFalsePerms(), ...(data.perms || {}) };
    return { hasAccess: !!data.hasAccess, disabled: !!data.disabled, isAdmin: !!data.isAdmin, perms };
  } catch (e) {
    // Не удалось связаться с panel - fail CLOSED (отказ доступа), а НЕ открытый доступ по умолчанию
    console.error("betmarkPerms: не удалось связаться с panel:", (e as Error).message);
    return DENIED_RESULT;
  }
}

export async function getPermsForUsername(username: string): Promise<BetmarkPermsResult> {
  const cached = cache.get(username);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await fetchPermsFromWebpanel(username);
  cache.set(username, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function getUsernameFromRequest(request: NextRequest): Promise<string | null> {
  const session = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  return session?.username ?? null;
}

export async function getPermsForRequest(request: NextRequest): Promise<BetmarkPermsResult | null> {
  const username = await getUsernameFromRequest(request);
  if (!username) return null;
  return getPermsForUsername(username);
}

function forbidden(detail: string) {
  return NextResponse.json({ error: detail }, { status: 403 });
}

/** Возвращает {ok:false, response} для немедленного `return`, если доступа нет */
export async function requirePerm(
  request: NextRequest,
  key: BetmarkPermKey
): Promise<{ ok: true; username: string; perms: BetmarkPerms } | { ok: false; response: NextResponse }> {
  const username = await getUsernameFromRequest(request);
  if (!username) {
    return { ok: false, response: NextResponse.json({ error: "не авторизован" }, { status: 401 }) };
  }
  const result = await getPermsForUsername(username);
  if (!result.hasAccess) {
    return { ok: false, response: forbidden("доступ к Betmark для этого аккаунта отключён") };
  }
  if (!result.perms[key]) {
    return { ok: false, response: forbidden("недостаточно прав для этого действия") };
  }
  return { ok: true, username, perms: result.perms };
}

// Пример использования в API-роуте: export async function POST
