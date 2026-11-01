export const CRYPTO_BOOKMAKER_SLUGS: ReadonlySet<string> = new Set([
  "bookm", "booko", "bookn", "bookp", "books", "bookr", "booku", "bookt", "bookq",
]);

export function isCryptoSlug(slug: string): boolean {
  return CRYPTO_BOOKMAKER_SLUGS.has(slug);
}

// Запрос пришёл на крипто-поддомен? nginx на сервере пробрасывает исходный Host в X-Forwarded-Host
export function isCryptoHost(headers: { get(name: string): string | null }): boolean {
  const host = (headers.get("x-forwarded-host") || headers.get("host") || "").toLowerCase();
  return host.startsWith("crypto.") || host.startsWith("krypto.");
}
