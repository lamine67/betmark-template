import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

// Тонкий прокси до panel - токен для X-Internal-Token живёт только тут, на сервере, в браузер никогда не уходит
export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "proxies_view");
  if (!auth.ok) return auth.response;

  if (!process.env.WEBPANEL_INTERNAL_URL) return NextResponse.json({ proxies: [], note: "внешняя панель прокси не подключена" });
  const base = process.env.WEBPANEL_INTERNAL_URL;
  const token = process.env.INTERNAL_API_TOKEN;
  const res = await fetch(`${base}/api/internal/proxy-status`, {
    headers: { "X-Internal-Token": token || "" },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
