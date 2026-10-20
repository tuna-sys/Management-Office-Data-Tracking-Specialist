import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/local-request";
import { resultError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function GET(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const p = r.nextUrl.searchParams,
      search = p.get("search")?.trim(),
      id = p.get("id");
    if (!search && !id) return NextResponse.json({ success: true, data: [] });
    if (p.get("review") === "true") {
      if (!id) return NextResponse.json({ success: true, data: [] });
      const logs = await prisma.auditLog.findMany({
        where: { module: "DUPLICATE_REVIEW", action: "REVIEW_SOURCE", details: { contains: id } },
        orderBy: { createdAt: "desc" },
      });
      const data = logs.flatMap(log => {
        try {
          const details = JSON.parse(log.details);
          if (!["APPROVE_SOURCE", "APPLY_FIELDS"].includes(details.decision) || details.after?.worker?.id !== id ||
            (p.get("assignmentId") && details.after?.assignment?.id !== p.get("assignmentId"))) return [];
          return [{ id: log.id, createdAt: log.createdAt, reviewer: log.operator,
            changes: details.changes || [], sourceFile: details.source?.file, sourceRow: details.source?.row }];
        } catch { return []; }
      });
      return NextResponse.json({ success: true, data });
    }
    const data = await prisma.worker.findMany({
      where: id
        ? { id }
        : {
            OR: [
              { idCard: search },
              { code: search },
              { assignments: { some: { employeeCode: search } } },
            ],
          },
      include: {
        bankAccounts: true,
        assignments: {
          include: {
            order: true,
            batch: true,
            events: { orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] },
            bonusRecords: true,
            enrollments: {
              include: {
                stages: {
                  include: { payments: true },
                  orderBy: { step: "asc" },
                },
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
      },
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return resultError(e);
  }
}
