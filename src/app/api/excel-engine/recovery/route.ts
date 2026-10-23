import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/local-request";
import { listImportRecovery, recoverCommittedImport } from "@/lib/import-recovery";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  try { return NextResponse.json({ success: true, data: await listImportRecovery(prisma) }); }
  catch { return NextResponse.json({ success: false, message: "Không đọc được trạng thái phục hồi import" }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (body.confirm !== true || body.action !== "RECOVER" || typeof body.importRunId !== "string")
      return NextResponse.json({ success: false, message: "Cần chọn phiên và xác nhận phục hồi" }, { status: 400 });
    return await recoverCommittedImport(prisma, body.importRunId.toLowerCase());
  } catch (error: any) { return NextResponse.json({ success: false, message: error?.message || "Chưa phục hồi được phiên import", importRunId: error?.importRunId, recoveryState: error?.recoveryState }, { status: error?.status || 500 }); }
}
