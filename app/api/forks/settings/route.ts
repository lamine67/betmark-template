// Личные настройки сканера вилок (фильтры, сортировка, калькулятор, валюты, звук, ссылки)
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { forksDb } from "../_db";

export const dynamic = "force-dynamic";
const MAX_BYTES = 300_000;

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const row = await forksDb.forkUserSettings.findUnique({ where: { username: auth.username } });
  return NextResponse.json({ data: row?.data ?? null, updatedAt: row?.updatedAt ?? null });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "настройки слишком большие" }, { status: 413 });
  let body: { data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "неверный JSON" }, { status: 400 });
  }
  if (!body || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) {
    return NextResponse.json({ error: "data должен быть объектом" }, { status: 400 });
  }
  const row = await forksDb.forkUserSettings.upsert({
    where: { username: auth.username },
    create: { username: auth.username, data: body.data as object },
    update: { data: body.data as object },
  });
  return NextResponse.json({ ok: true, updatedAt: row.updatedAt });
}
