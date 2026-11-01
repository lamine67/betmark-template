import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

// Ответ на один вопрос квиза "Помогите Betmark"
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePerm(request, "board_view");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.answer !== "boolean") {
    return NextResponse.json({ error: "нужно boolean-поле answer" }, { status: 400 });
  }

  const match = await prisma.match.findUnique({ where: { id } });
  if (!match) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.match.update({
    where: { id },
    data: { topLeagueReviewAnswer: body.answer, topLeagueFlagged: false },
  });

  return NextResponse.json({ ok: true });
}
