import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { requirePerm } from "@/lib/betmarkPerms";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requirePerm(request, "sync_force_now");
  if (!auth.ok) return auth.response;

  const child = spawn(`${process.env.BETMARK_HOME || process.cwd()}/sync-scheduler.sh`, ["--force"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return NextResponse.json({ ok: true });
}
