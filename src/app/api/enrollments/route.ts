import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, identity } from "@/lib/auth";
import {
  DomainError,
  resultError,
  day,
  monthOf,
  rulesOf,
  today,
  text,
} from "@/lib/domain";
export const dynamic = "force-dynamic";
const include = {
  stages: { include: { payments: true }, orderBy: { step: "asc" as const } },
  assignment: { include: { worker: true, order: true, batch: true } },
};
export async function GET(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const p = r.nextUrl.searchParams;
    const dbEnrollments = await prisma.policyEnrollment.findMany({
      include,
      orderBy: { createdAt: "desc" },
    });
    const existingAssignmentIds = new Set(
      dbEnrollments.map((e) => e.assignmentId).filter(Boolean),
    );

    const bonusRecords = await prisma.bonusRecord.findMany({
      include: {
        worker: true,
        assignment: {
          include: {
            order: true,
            batch: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const bonusEnrollments = bonusRecords
      .filter((b) => !b.assignmentId || !existingAssignmentIds.has(b.assignmentId))
      .map((b) => {
        let noteObj: any = {};
        try {
          noteObj = JSON.parse(b.note || "{}");
        } catch {}
        const rewards = Array.isArray(noteObj.rewards) ? noteObj.rewards : [];

        const stages = Array.from({ length: 7 }, (_, i) => {
          const step = i + 1;
          const labelRaw = String(rewards[i] || "").trim();
          const amount = Number((b as any)[`bonus${step}`] || 0);

          let thresholdDays: number | null = null;
          const mDays = /(\d+)\s*công/i.exec(labelRaw);
          if (mDays) thresholdDays = Number(mDays[1]);
          else if (/1\s*tháng/i.test(labelRaw)) thresholdDays = 26;
          else if (/3\s*tháng/i.test(labelRaw)) thresholdDays = 78;
          else if (/6\s*tháng/i.test(labelRaw)) thresholdDays = 156;

          const label = labelRaw || `Thưởng lần ${step}`;
          const achieved = amount > 0;
          const eligible = achieved || (labelRaw ? !/^(ko|không|hết)/i.test(labelRaw) : false);

          const payments = achieved
            ? [
                {
                  id: `pay-${b.id}-${step}`,
                  stageId: `stage-${b.id}-${step}`,
                  amount: amount,
                  paidOn: b.interviewDate || "Tháng 05/2026",
                  reference: `UNC-EXCEL-L${step}`,
                  note: `Đã chi trả theo file Excel nguồn: ${label}`,
                  confirmedBy: "Nguồn Excel",
                  createdAt: b.createdAt,
                },
              ]
            : [];

          return {
            id: `stage-${b.id}-${step}`,
            enrollmentId: `enroll-${b.id}`,
            step,
            label,
            thresholdDays,
            amount,
            eligible,
            eligibleAsOf: achieved ? b.interviewDate : null,
            achieved,
            achievedOn: achieved ? b.interviewDate : null,
            confirmedBy: achieved ? "Nguồn Excel" : null,
            confirmationNote: labelRaw || null,
            updatedAt: b.updatedAt,
            payments,
          };
        });

        const monthOriginal = noteObj.monthOriginal || b.month || "";

        return {
          id: b.id,
          assignmentId: b.assignmentId || b.id,
          policyId: "excel-source-policy",
          policyName: b.policy || "Chính sách thưởng theo Excel",
          factory: b.company,
          effectiveFrom: b.interviewDate || "2026-01-01",
          effectiveTo: "2026-12-31",
          rulesSnapshot: "[]",
          createdBy: "Import Excel",
          createdAt: b.createdAt,
          isSourceExcel: true,
          stages,
          assignment: {
            id: b.assignmentId || b.id,
            workerId: b.workerId,
            employeeCode: b.workerCode || b.worker?.code || "",
            interviewDate: b.interviewDate || "",
            onboardingMonth: monthOriginal,
            interviewFactory: b.company,
            workingFactory: b.company,
            orderId: b.assignment?.orderId || null,
            worker: b.worker || {
              id: b.workerId,
              fullName: "Người lao động",
              idCard: "",
              phone: "",
              code: b.workerCode || "",
            },
            order: b.assignment?.order || null,
            batch: b.assignment?.batch || null,
          },
        };
      });

    let rows: any[] = [...dbEnrollments, ...bonusEnrollments];

    const month = p.get("month") || "";
    const factory = p.get("factory") || p.get("company") || "";
    const idCard = p.get("idCard")?.trim() || "";
    const workerCode = p.get("workerCode")?.trim() || "";
    const search = p.get("search")?.trim() || "";
    const assignmentId = p.get("assignmentId") || "";

    function matchesMonth(targetMonth: string, filterMonth: string): boolean {
      if (!filterMonth) return true;
      if (!targetMonth) return false;
      const cleanT = targetMonth.toLowerCase().replace(/[^0-9]/g, "");
      const cleanF = filterMonth.toLowerCase().replace(/[^0-9]/g, "");
      if (targetMonth === filterMonth) return true;
      if (cleanT && cleanF && (cleanT.includes(cleanF) || cleanF.includes(cleanT))) return true;
      return false;
    }

    rows = rows.filter((e) => {
      const a = e.assignment;
      const w = a?.worker;
      if (!a || !w) return false;

      if (month) {
        const m1 = monthOf(a.interviewDate);
        const m2 = a.onboardingMonth || "";
        if (!matchesMonth(m1, month) && !matchesMonth(m2, month)) {
          return false;
        }
      }

      if (factory) {
        const fLower = factory.toLowerCase();
        const fMatch =
          (e.factory && e.factory.toLowerCase().includes(fLower)) ||
          (a.interviewFactory && a.interviewFactory.toLowerCase().includes(fLower)) ||
          (a.workingFactory && a.workingFactory.toLowerCase().includes(fLower));
        if (!fMatch) return false;
      }

      if (p.get("orderId") && a.orderId !== p.get("orderId")) return false;
      if (assignmentId && e.assignmentId !== assignmentId) return false;

      if (idCard) {
        if (!w.idCard || !w.idCard.toLowerCase().includes(idCard.toLowerCase())) {
          return false;
        }
      }

      if (workerCode) {
        const code = a.employeeCode || w.code || "";
        if (!code.toLowerCase().includes(workerCode.toLowerCase())) {
          return false;
        }
      }

      if (search) {
        const sLower = search.toLowerCase();
        const matched =
          (w.fullName && w.fullName.toLowerCase().includes(sLower)) ||
          (w.idCard && w.idCard.toLowerCase().includes(sLower)) ||
          (a.employeeCode && a.employeeCode.toLowerCase().includes(sLower)) ||
          (w.code && w.code.toLowerCase().includes(sLower));
        if (!matched) return false;
      }

      return true;
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (e) {
    return resultError(e);
  }
}
export async function POST(r: NextRequest) {
  const denied = await guard(r, "bonus:write");
  if (denied) return denied;
  try {
    const b = await r.json(),
      actor = (await identity(r))!;
    const data = await prisma.$transaction(async (tx) => {
      const a = await tx.workAssignment.findUnique({
          where: { id: text(b.assignmentId, "đợt lao động") },
        }),
        p = await tx.bonusPolicy.findUnique({
          where: { id: text(b.policyId, "chính sách") },
        });
      if (!a || !p)
        throw new DomainError(
          "Không tìm thấy đợt lao động hoặc chính sách",
          404,
        );
      const pv = day(a.interviewDate, "ngày PV"),
        passed = day(a.passedDate, "ngày đỗ");
      if (a.interviewResult !== "PASS" || passed < pv)
        throw new DomainError(
          "Cần xác nhận kết quả Đỗ và ngày đỗ trước khi áp dụng thưởng",
        );
      if (
        !p.isActive ||
        !p.effectiveFrom ||
        !p.effectiveTo ||
        pv < p.effectiveFrom ||
        pv > p.effectiveTo
      )
        throw new DomainError(
          "Ngày PV không thuộc hiệu lực chính sách đang áp dụng",
        );
      if (
        p.factory !== (a.workingFactory || a.interviewFactory) ||
        (p.orderId && p.orderId !== a.orderId)
      )
        throw new DomainError(
          "Chính sách không thuộc công ty/đơn hàng của đợt này",
        );
      const rules = rulesOf(JSON.parse(p.rulesJson));
      const row = await tx.policyEnrollment.create({
        data: {
          assignmentId: a.id,
          policyId: p.id,
          policyName: p.name,
          factory: p.factory,
          effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo,
          rulesSnapshot: JSON.stringify(rules),
          createdBy: actor.username,
          stages: {
            create: rules.map((s) => ({
              step: s.step,
              label: s.milestone,
              thresholdDays: s.thresholdDays,
              amount: s.amount,
            })),
          },
        },
        include,
      });
      await tx.auditLog.create({
        data: {
          action: "APPLY_POLICY",
          module: "BONUS",
          operator: actor.username,
          details: `Áp dụng snapshot chính sách ${p.id} cho đợt ${a.id}`,
        },
      });
      return row;
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (e) {
    return resultError(e);
  }
}
export async function PUT(r: NextRequest) {
  const denied = await guard(r, "bonus:write");
  if (denied) return denied;
  try {
    const b = await r.json(),
      actor = (await identity(r))!;
    const data = await prisma.$transaction(async (tx) => {
      const s = await tx.rewardStage.findUnique({
        where: { id: text(b.id, "mốc thưởng") },
        include: {
          payments: true,
          enrollment: { include: { assignment: true } },
        },
      });
      if (!s) throw new DomainError("Không tìm thấy mốc", 404);
      if (s.updatedAt.toISOString() !== b.updatedAt)
        throw new DomainError("Mốc đã thay đổi, tải lại", 409);
      if (
        typeof b.eligible !== "boolean" ||
        typeof b.achieved !== "boolean" ||
        (b.achieved && !b.eligible)
      )
        throw new DomainError("Đạt mốc yêu cầu xác nhận đủ điều kiện xét");
      if (s.payments.length && (!b.eligible || !b.achieved))
        throw new DomainError(
          "Mốc đã có chi trả: không được thu hồi xác nhận",
          409,
        );
      const asOf = b.eligible
          ? day(b.eligibleAsOf, "ngày xét điều kiện")
          : null,
        achievedOn = b.achieved ? day(b.achievedOn, "ngày đạt mốc") : null;
      const passed = day(s.enrollment.assignment.passedDate, "ngày đỗ");
      if (
        (asOf && (asOf <= passed || asOf > today())) ||
        (achievedOn &&
          (achievedOn <= passed || achievedOn > today() || achievedOn > asOf!))
      )
        throw new DomainError(
          "Ngày xét/đạt phải sau ngày đỗ và không vượt ngày xét hoặc hiện tại",
        );
      if (
        b.achieved &&
        s.thresholdDays !== null &&
        (s.enrollment.assignment.confirmedWorkDays === null ||
          s.enrollment.assignment.confirmedWorkDays < s.thresholdDays)
      )
        throw new DomainError(
          "Cần chốt đủ số công thủ công trước khi xác nhận đạt mốc",
        );
      const row = await tx.rewardStage.update({
        where: { id: s.id },
        data: {
          eligible: b.eligible,
          eligibleAsOf: asOf,
          achieved: b.achieved,
          achievedOn,
          confirmedBy: actor.username,
          confirmationNote:
            text(b.note, "ghi chú xác nhận", false, 1000) || null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CONFIRM_STAGE",
          module: "BONUS",
          operator: actor.username,
          details: `Mốc ${s.id}: đủ điều kiện=${b.eligible}, đạt=${b.achieved}`,
        },
      });
      return row;
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return resultError(e);
  }
}
