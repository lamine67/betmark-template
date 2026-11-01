import type { NextRequest } from "next/server";

// Next.js Route Handlers (Node-рантайм, в отличие от middleware.ts на Edge) строят request.url из адреса
export function absoluteUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "example.com";
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = request.headers.get("x-forwarded-proto") || (local ? "http" : "https");
  return new URL(path, `${proto}://${host}`);
}
