import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/local-request";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  const p = request.nextUrl.searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Math.trunc(Number(p.get("page"))) || 1),
  );
  const where = {
    ...(p.get("module") ? { module: p.get("module")! } : {}),
    ...(p.get("operator")
      ? { operator: { contains: p.get("operator")! } }
      : {}),
  };
  try {
    const [dbRows, dbTotal] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: page * 20,
      }),
      prisma.auditLog.count({ where }),
    ]);
    const merged = [...dbRows].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        b.id.localeCompare(a.id),
    );
    return NextResponse.json({
      success: true,
      data: merged.slice((page - 1) * 20, page * 20),
      total: dbTotal,
      page,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể tải lịch sử" },
      { status: 500 },
    );
  }
}
