import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

const g = globalThis as unknown as { __activeBooksPrisma?: PrismaClient };
const prisma = g.__activeBooksPrisma ?? new PrismaClient();
g.__activeBooksPrisma = prisma;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let denied: Awaited<ReturnType<typeof requirePerm>> | null = null;
  let allowed = false;
  for (const key of ["board_view", "live_view", "status_view"] as const) {
    const a = await requirePerm(request, key);
    if (a.ok) {
      allowed = true;
      break;
    }
    denied = denied ?? a;
  }
  if (!allowed && denied && !denied.ok) return denied.response;
  const rows = await prisma.bookmaker.findMany({ where: { active: true }, select: { slug: true } });
  return NextResponse.json({ slugs: rows.map((r) => r.slug) });
}
