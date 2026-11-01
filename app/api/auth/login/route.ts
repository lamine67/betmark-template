import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "../../../../lib/session";
import { absoluteUrl } from "../../../../lib/http";
import { usesExternalAuth, verifyLocalLogin } from "../../../../lib/localAuth";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/board");

  const base = process.env.WEBPANEL_INTERNAL_URL;
  const token = process.env.INTERNAL_API_TOKEN;
  let ok = false;
  let errorMsg = "Неверный логин или пароль";
  if (!usesExternalAuth()) {
    ok = await verifyLocalLogin(username, password);
  } else try {
    const res = await fetch(`${base}/api/internal/verify-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": token || "" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    if (res.ok) {
      ok = true;
    } else {
      const data = await res.json().catch(() => null);
      if (data?.detail) errorMsg = data.detail;
    }
  } catch {
    errorMsg = "Не удалось связаться с сервером входа";
  }

  if (!ok) {
    const qs = new URLSearchParams({ error: errorMsg });
    if (next !== "/") qs.set("next", next);
    return NextResponse.redirect(absoluteUrl(request, `/login?${qs.toString()}`));
  }

  const cookieValue = await createSessionCookieValue(username);
  const response = NextResponse.redirect(absoluteUrl(request, next && next.startsWith("/") ? next : "/board"));
  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== "false",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return response;
}
