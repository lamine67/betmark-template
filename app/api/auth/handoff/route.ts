import { NextRequest, NextResponse } from "next/server";
import { createHandoffToken, verifySessionCookieValue, SESSION_COOKIE_NAME } from "../../../../lib/session";
import { absoluteUrl } from "../../../../lib/http";

export const dynamic = "force-dynamic";

// Переход между example.com и example.com без повторного ввода пароля
const TARGET_HOSTS: Record<string, string> = { crypto: "example.com", main: "example.com" };

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/board";
}

export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const host = TARGET_HOSTS[to];
  if (!host) return NextResponse.redirect(absoluteUrl(request, "/board"));

  const session = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    const qs = new URLSearchParams({ next: `/api/auth/handoff?to=${to}&next=${encodeURIComponent(next)}` });
    return NextResponse.redirect(absoluteUrl(request, `/login?${qs.toString()}`));
  }

  const token = await createHandoffToken(session.username);
  const target = new URL(`https://example.com`);
  target.searchParams.set("t", token);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}
