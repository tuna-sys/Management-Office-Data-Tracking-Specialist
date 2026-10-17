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
    let rows = await prisma.policyEnrollment.findMany({
      include,
      orderBy: { createdAt: "desc" },
    });
    const month = p.get("month") || "";
    const factory = p.get("factory") || p.get("company") || "";
    const idCard = p.get("idCard")?.trim() || "";
    const workerCode = p.get("workerCode")?.trim() || "";
    const search = p.get("search")?.trim() || "";
    const assignmentId = p.get("assignmentId") || "";

    rows = rows.filter(
      (e) =>
        (!month ||
          monthOf(e.assignment.interviewDate) === month ||
          e.assignment.onboardingMonth === month) &&
        (!factory ||
          e.factory === factory ||
          e.assignment.interviewFactory === factory ||
          e.assignment.workingFactory === factory) &&
        (!p.get("orderId") || e.assignment.orderId === p.get("orderId")) &&
        (!assignmentId || e.assignmentId === assignmentId) &&
        (!idCard ||
          e.assignment.worker.idCard
            ?.toLowerCase()
            .includes(idCard.toLowerCase())) &&
        (!workerCode ||
          (e.assignment.employeeCode || e.assignment.worker.code)
            ?.toLowerCase()
            .includes(workerCode.toLowerCase())) &&
        (!search ||
          [
            e.assignment.worker.fullName,
            e.assignment.worker.idCard,
            e.assignment.employeeCode,
            e.assignment.worker.code,
          ].some((v) =>
            v?.toLowerCase().includes(search.toLowerCase()),
          )),
    );
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
