// Режим «сам по себе» (по умолчанию): один администратор из переменных окружения, без внешней панели пользователей

export function usesExternalAuth(): boolean {
  return !!process.env.WEBPANEL_INTERNAL_URL;
}

export function localAdminName(): string {
  return process.env.ADMIN_USER || "admin";
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyLocalLogin(username: string, password: string): Promise<boolean> {
  if (!safeEqual(username, localAdminName())) return false;
  const hash = (process.env.ADMIN_PASSWORD_SHA256 || "").toLowerCase();
  if (hash) return safeEqual(await sha256Hex(password), hash);
  const plain = process.env.ADMIN_PASSWORD || "";
  if (plain.length < 8) return false; // пустой или короткий пароль не принимаем
  return safeEqual(password, plain);
}
