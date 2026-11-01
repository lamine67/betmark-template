import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, "proxies_rename");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  if (!process.env.WEBPANEL_INTERNAL_URL) return NextResponse.json({ error: "внешняя панель прокси не подключена" }, { status: 501 });
  const base = process.env.WEBPANEL_INTERNAL_URL;
  const token = process.env.INTERNAL_API_TOKEN;
  const res = await fetch(`${base}/api/internal/proxy-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": token || "" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
