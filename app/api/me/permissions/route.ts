// Права текущего пользователя - клиентские страницы
import { NextRequest, NextResponse } from "next/server";
import { getPermsForRequest } from "@/lib/betmarkPerms";

export async function GET(request: NextRequest) {
  const result = await getPermsForRequest(request);
  if (!result) {
    return NextResponse.json({ error: "не авторизован" }, { status: 401 });
  }
  return NextResponse.json(result);
}
