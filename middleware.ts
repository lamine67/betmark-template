import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionCookieValue, SESSION_COOKIE_NAME } from "./lib/session";

// Публичная обложка ("/") + страница входа - без сессии
const PUBLIC_PATHS = ["/", "/login", "/robots.txt"];
const STATIC_ASSET_RE = /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|css|js|map|glb|gltf|webmanifest)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/api/auth/") ||
    // /api/public/* агрегированная статистика по конторам для обложки (кликабельная лента контор)
    pathname.startsWith("/api/public/") ||
    // /api/internal/* - сервис-к-сервису вызовы ИЗ panel (панель управления → вкладка покрытия → покрытие топ-лиг)
    pathname.startsWith("/api/internal/") ||
    // /api/agent/bookk/* - сервис-к-сервису вызовы от домашнего агента
    pathname.startsWith("/api/agent/") ||
    pathname.startsWith("/_next/") ||
    STATIC_ASSET_RE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const session = await verifySessionCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
