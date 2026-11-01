import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieValue, verifyHandoffToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "../../../../lib/session";
import { absoluteUrl } from "../../../../lib/http";

export const dynamic = "force-dynamic";

// Принимает токен передачи сессии (см. /api/auth/handoff) и выставляет обычную сессионную cookie для ЭТОГО домена
const used = new Map<string, number>();

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/board";
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);

  const verified = await verifyHandoffToken(token);
  if (!verified || !token || used.has(token)) {
    const qs = new URLSearchParams({ next });
    return NextResponse.redirect(absoluteUrl(request, `/login?${qs.toString()}`));
  }
  used.set(token, now + 5 * 60 * 1000);

  const response = NextResponse.redirect(absoluteUrl(request, next));
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionCookieValue(verified.username), {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return response;
}
