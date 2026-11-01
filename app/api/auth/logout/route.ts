import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "../../../../lib/session";
import { absoluteUrl } from "../../../../lib/http";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.redirect(absoluteUrl(request, "/"));
}
