// Скрытое пользователем в сканере вилок: вилка (key = id), матч (key = matchId)
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";
import { forksDb } from "../_db";

export const dynamic = "force-dynamic";
const KINDS = new Set(["fork", "match", "pair"]);

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const rows = await forksDb.forkHidden.findMany({ where: { username: auth.username }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ hidden: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const b = await request.json().catch(() => null);
  if (!b || !KINDS.has(b.kind) || typeof b.key !== "string" || !b.key || b.key.length > 300) {
    return NextResponse.json({ error: "нужны kind (fork|match|pair) и key" }, { status: 400 });
  }
  const label = typeof b.label === "string" ? b.label.slice(0, 300) : "";
  const row = await forksDb.forkHidden.upsert({
    where: { username_kind_key: { username: auth.username, kind: b.kind, key: b.key } },
    create: { username: auth.username, kind: b.kind, key: b.key, label },
    update: { label },
  });
  return NextResponse.json({ hidden: row });
}

export async function DELETE(request: NextRequest) {
  const auth = await requirePerm(request, "forks_view");
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  if (sp.get("all") === "1") {
    const r = await forksDb.forkHidden.deleteMany({ where: { username: auth.username } });
    return NextResponse.json({ deleted: r.count });
  }
  const id = sp.get("id");
  if (!id) return NextResponse.json({ error: "нужен id" }, { status: 400 });
  const r = await forksDb.forkHidden.deleteMany({ where: { id, username: auth.username } });
  return NextResponse.json({ deleted: r.count });
}
