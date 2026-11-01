// Подписанная HMAC-кука для входа на example.com
const COOKIE_NAME = "betmark_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 лет

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 16) throw new Error("SESSION_SECRET не задан или короче 16 символов (см. .env.example)");
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const str = atob(b64);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

export async function createSessionCookieValue(username: string): Promise<string> {
  const payload = JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_SECONDS * 1000 });
  const encoded = toBase64Url(new TextEncoder().encode(payload));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(sig)}`;
}

export async function verifySessionCookieValue(value: string | undefined): Promise<{ username: string } | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromBase64Url(sig);
  } catch {
    return null;
  }
  const key = await getKey();
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, new TextEncoder().encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.u !== "string") return null;
    if (payload.p) return null; // токен передачи (см. verifyHandoffToken) не годится как сессия
    return { username: payload.u };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE = MAX_AGE_SECONDS;

// сессионная cookie привязана к домену, поэтому вход на example.com не действовал на example.com (и наоборот)
const HANDOFF_TTL_MS = 60 * 1000;

async function signPayload(payload: object): Promise<string> {
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(sig)}`;
}

export async function createHandoffToken(username: string): Promise<string> {
  return signPayload({ u: username, exp: Date.now() + HANDOFF_TTL_MS, p: "handoff" });
}

export async function verifyHandoffToken(value: string | null | undefined): Promise<{ username: string } | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromBase64Url(sig);
  } catch {
    return null;
  }
  const key = await getKey();
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, new TextEncoder().encode(encoded));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (payload.p !== "handoff" || typeof payload.u !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { username: payload.u };
  } catch {
    return null;
  }
}
