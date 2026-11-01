// "Калибровка парсинга" - список заявок для /status
import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  const auth = await requirePerm(request, "calibration_view");
  if (!auth.ok) return auth.response;
  // FLAGGED-заявки несут в message технический диагноз (explainClassification, lib/calibration.ts)
  const canViewDiagnosis = auth.perms.calibration_view_diagnosis;

  const rows = await prisma.calibrationSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { bookmaker: true },
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      bookmakerSlug: r.bookmaker.slug,
      bookmakerName: r.bookmaker.name,
      sportSlug: r.sportSlug,
      kind: r.kind,
      url: r.url,
      hasPhoto: !!r.photoPath,
      status: r.status,
      extractedLeagueName: r.extractedLeagueName,
      extractedTeams: r.extractedTeams,
      matchesFound: r.matchesFound,
      message: r.status === "FLAGGED" && !canViewDiagnosis ? null : r.message,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }))
  );
}
