import { cachedRead } from "@/lib/read-cache";
import { readDataVersion } from "@/lib/read-data-version";
import { sourcePaidReport } from "@/lib/source-paid-report";
import { readImportSources } from "@/lib/import-source-store";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/local-request";
import {
  recruitmentReport,
  rewardReport,
  matchesAssignment,
} from "@/lib/reporting";
import { resultError, DomainError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function GET(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const p = r.nextUrl.searchParams;
    if (p.get("month") && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month")!))
      throw new DomainError("Tháng PV không hợp lệ");
    const version = await readDataVersion();
    const query = new URLSearchParams(p);
    for (const key of ["view", "page", "pageSize", "tableSearch"]) query.delete(key);
    query.sort();
    const data = await cachedRead("report:" + query.toString(), version, async () => {
      const [workers, enrollments, imported, sources] = await cachedRead("report-inputs", version, () => Promise.all([
        prisma.worker.findMany({
          select: {
            id: true,
            idCard: true,
            code: true,
            fullName: true,
            dob: true,
            gender: true,
            province: true,
            address: true,
            archivedAt: true,
            assignments: {
              select: {
                id: true,
                workerId: true,
                interviewDate: true,
                interviewFactory: true,
                employeeCode: true,
                status: true,
                interviewResult: true,
                startDate: true,
                confirmedWorkDays: true,
                orderId: true,
                recruiter: true,
                team: true,
                batchId: true,
                order: { select: { name: true } },
                batch: { select: { id: true, target: true, periodMonth: true } },
              },
            },
          },
        }),
        prisma.policyEnrollment.findMany({
          select: {
            id: true,
            factory: true,
            policyName: true,
            assignment: {
              select: {
                interviewDate: true,
                interviewFactory: true,
                employeeCode: true,
                orderId: true,
                recruiter: true,
                team: true,
                order: { select: { name: true } },
                batch: { select: { id: true, periodMonth: true } },
                worker: {
                  select: { idCard: true, code: true, fullName: true },
                },
              },
            },
            stages: {
              select: {
                label: true,
                thresholdDays: true,
                amount: true,
                eligible: true,
                achieved: true,
                payments: { select: { amount: true } },
              },
            },
          },
        }),
        prisma.bonusRecord.findMany({
          where: { note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
          select: {
            id: true,
            company: true,
            month: true,
            interviewDate: true,
            policy: true,
            workerCode: true,
            totalBonus: true,
            note: true,
            worker: { select: { idCard: true, fullName: true } },
            assignment: {
              select: {
                interviewDate: true,
                interviewFactory: true,
                orderId: true,
                recruiter: true,
                team: true,
                batch: { select: { id: true, periodMonth: true } },
              },
            },
          },
        }),
        readImportSources(),
      ]));
      const sourcePaid = sourcePaidReport(sources, workers, imported, p);
      return { sourcePaid, recruitment: recruitmentReport(workers, p), rewards: rewardReport(enrollments, p) };
    });
    if (p.get("view") === "overview") {
      const { rows, ...sourcePaid } = data.sourcePaid;
      return NextResponse.json({ success: true, data: { ...data, sourcePaid: { ...sourcePaid, rowCount: rows.length } } });
    }
    if (p.get("view") === "sourceRows") {
      const keyword = (p.get("tableSearch") || "").trim().toLocaleLowerCase("vi");
      const rows = keyword ? data.sourcePaid.rows.filter(row => Object.values(row).some(v => String(v ?? "").toLocaleLowerCase("vi").includes(keyword))) : data.sourcePaid.rows;
      const pageSize = Math.min(100, Math.max(1, Math.floor(Number(p.get("pageSize")) || 20)));
      const page = Math.min(Math.max(1, Math.floor(Number(p.get("page")) || 1)), Math.max(1, Math.ceil(rows.length / pageSize)));
      return NextResponse.json({ success: true, data: { rows: rows.slice((page - 1) * pageSize, page * pageSize), filteredTotal: rows.length, page, pageSize } });
    }
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return resultError(e);
  }
}
