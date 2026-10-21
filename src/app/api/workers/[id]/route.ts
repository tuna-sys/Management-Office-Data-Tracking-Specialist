import { assertDailyInterview, isActiveAssignment } from "@/lib/duplicate-check";
import { NextRequest, NextResponse } from "next/server";
import {
  assignmentRelations,
  assignmentEnded,
  resultError,
  today,
  day,
  DomainError,
} from "@/lib/domain";
import { prisma } from "@/lib/prisma";
import { guard, identity } from "@/lib/local-request";
import {
  WORKER_FIELDS,
  ASSIGNMENT_FIELDS,
  cleanFields,
  validateWorker,
  phoneKey,
  validateInterview,
} from "@/lib/worker-validation";
export async function PUT(
  request: NextRequest,
  {
    params,
  }: {
    params: {
      id: string;
    };
  },
) {
  const denied = await guard(request);
  if (denied) return denied;
  let body: any,
    worker: Record<string, string>,
    assignment: Record<string, string>;
  try {
    body = await request.json();
    worker = cleanFields(body, WORKER_FIELDS);
    if (body.idCard !== undefined) {
      worker.idCard = String(body.idCard).trim();
      if (!/^(\d{9}|\d{12})$/.test(worker.idCard))
        throw new Error("CCCD không hợp lệ");
    }
    assignment = cleanFields(body, ASSIGNMENT_FIELDS);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 400 },
    );
  }
  const actor = (await identity(request))!;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.worker.findUnique({
        where: { id: params.id },
        include: {
          assignments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        },
      });
      if (!current)
        return {
          status: 404,
          body: { success: false, message: "Không tìm thấy hồ sơ" },
        };
      const latest = current.assignments.find(
        (a) => a.id === body.assignmentId,
      );
      if (!latest)
        return {
          status: 409,
          body: { success: false, message: "Hồ sơ chưa có đợt tuyển dụng" },
        };
      if (
        !body.assignmentId ||
        body.updatedAt !== current.updatedAt.toISOString() ||
        body.assignmentUpdatedAt !== latest.updatedAt.toISOString()
      )
        return {
          status: 409,
          body: {
            success: false,
            message: "Hồ sơ hoặc đợt tuyển đã thay đổi, vui lòng tải lại",
          },
        };
      const merged = { ...latest, ...assignment };
      for (const [nameField, idField] of [
        ["interviewFactory", "interviewFactoryId"],
        ["workingFactory", "workingFactoryId"],
        ["status", "statusId"],
      ]) {
        if (
          assignment[nameField] !== undefined &&
          assignment[idField] === undefined &&
          assignment[nameField] !== latest[nameField]
        )
          merged[idField] = null;
      }
      assertDailyInterview(current, merged, latest.id);
      if (
        latest.status !== merged.status &&
        (await assignmentEnded(tx, latest.status)) &&
        !(await assignmentEnded(tx, merged.status))
      )
        return {
          status: 409,
          body: {
            success: false,
            message: "Dùng tái tuyển dụng để giữ lịch sử đợt đã nghỉ",
          },
        };
      if (
        ![
          "Đã nghỉ việc",
          "Nghỉ hẳn",
          "Hết hợp đồng",
          "Bỏ xưởng",
          "Bỏ vì sức khỏe",
          "Hết phí",
        ].includes(merged.status)
      ) {
        assignment.leaveDate = "";
        assignment.leaveReason = "";
        merged.leaveDate = "";
        merged.leaveReason = "";
      }
      try {
        validateWorker({ ...current, ...worker }, merged);
        validateInterview(merged);
        await assignmentRelations(tx, merged, latest);
        for (const field of ["interviewFactoryId", "workingFactoryId", "statusId"])
          if (merged[field] !== latest[field]) assignment[field] = merged[field];
        if (body.recruiterId !== undefined || body.teamId !== undefined)
          Object.assign(assignment, {
            recruiter: merged.recruiter,
            team: merged.team,
            teamId: merged.teamId,
          });
      } catch (error: any) {
        return {
          status: 400,
          body: { success: false, message: error.message },
        };
      }
      if (worker.phone) {
        const names = await tx.laborStatus.findMany({
          where: { isActive: true },
        });
        const others = await tx.worker.findMany({
          where: {
            id: { not: current.id },
            phone: { not: null },
            archivedAt: null,

          },
          include: { assignments: true },
        });
        if (
          others.some((w) => phoneKey(w.phone!) === worker.phone && w.assignments.some((a) => isActiveAssignment(a, names))) &&
          body.confirmPhoneDuplicate !== true
        )
          return {
            status: 409,
            body: {
              success: false,
              isDuplicate: true,
              duplicateType: "PHONE",
              message: "SĐT đã có trong hồ sơ khác; cần xác nhận dùng chung số",
            },
          };
      }
      const enrolled = await tx.policyEnrollment.count({
        where: { assignmentId: latest.id },
      });
      if (
        enrolled &&
        [
          "interviewDate",
          "passedDate",
          "interviewResult",
          "interviewFactory",
          "orderId",
          "batchId",
        ].some(
          (f) => assignment[f] !== undefined && assignment[f] !== latest[f],
        )
      )
        throw new DomainError(
          "Đợt đã áp dụng chính sách: không thay ngày PV, ngày đỗ, kết quả hoặc đơn hàng",
          409,
        );
      if (body.confirmedWorkDays !== undefined) {
        const count = body.confirmedWorkDays;
        if (
          typeof count !== "number" ||
          !Number.isFinite(count) ||
          count < 0 ||
          count > 10000
        )
          throw new DomainError("Số công xác nhận không hợp lệ");
        const asOf = day(body.workDaysAsOf, "ngày chốt công"),
          passed = merged.passedDate ? day(merged.passedDate, "ngày đỗ") : null;
        if (asOf > today())
          throw new DomainError("Ngày chốt công không được vượt ngày hiện tại");
        if (
          !passed ||
          asOf <= passed ||
          count > (Date.parse(asOf) - Date.parse(passed)) / 86400000
        )
          throw new DomainError(
            "Chỉ chốt công sau ngày đỗ; số công không vượt số ngày trong khoảng",
          );
        Object.assign(assignment, {
          confirmedWorkDays: count,
          workDaysAsOf: asOf,
          workDaysConfirmedBy: actor.username,
        });
      }
      await tx.worker.update({ where: { id: params.id }, data: worker });
      await tx.workAssignment.update({
        where: { id: latest.id },
        data: assignment,
      });
      await tx.assignmentEvent.create({
        data: {
          assignmentId: latest.id,
          occurredOn: body.eventDate
            ? day(body.eventDate, "ngày thay đổi")
            : today(),
          fromStatus: latest.status,
          toStatus: merged.status,
          interviewResult: merged.interviewResult,
          operator: actor.username,
          note: body.eventNote ? String(body.eventNote).slice(0, 1000) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          module: "WORKER",
          operator: actor.username,
          details: `Cập nhật hồ sơ ${current.id}, đợt ${latest.id}: ${latest.status} → ${merged.status}`,
        },
      });
      return {
        status: 200,
        body: {
          success: true,
          data: await tx.worker.findUnique({
            where: { id: params.id },
            include: {
              assignments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
            },
          }),
        },
      };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    return resultError(e);
  }
}
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const actor = (await identity(request))!;
    const data = await prisma.$transaction(async (tx) => {
      const current = await tx.worker.findUnique({
        where: { id: params.id },
        include: { assignments: true },
      });
      if (!current) throw new DomainError("Không có hồ sơ", 404);
      const ended = await tx.laborStatus.findMany({
        where: { endsAssignment: true },
      });
      if (
        current.assignments.some((a) => !ended.some((s) => s.name === a.status))
      )
        throw new DomainError(
          "Hồ sơ có đợt đang hoạt động. Chốt trạng thái trước khi lưu trữ.",
          409,
        );
      const row = await tx.worker.update({
        where: { id: current.id },
        data: { archivedAt: new Date(), archivedBy: actor.username },
      });
      await tx.auditLog.create({
        data: {
          module: "WORKER",
          action: "ARCHIVE",
          operator: actor.username,
          details: `Lưu trữ hồ sơ ${current.id}; không xóa lịch sử`,
        },
      });
      return row;
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return resultError(e);
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const actor = (await identity(request))!;
    const data = await prisma.$transaction(async (tx) => {
      const row = await tx.worker.update({
        where: { id: params.id },
        data: { archivedAt: null, archivedBy: null },
      });
      await tx.auditLog.create({
        data: {
          module: "WORKER",
          action: "RESTORE",
          operator: actor.username,
          details: `Khôi phục hồ sơ ${row.id}`,
        },
      });
      return row;
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return resultError(e);
  }
}
