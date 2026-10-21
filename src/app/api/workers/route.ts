import { assertDailyInterview, identityText } from "@/lib/duplicate-check";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchesAssignment } from "@/lib/reporting";
import {
  assignmentRelations,
  assignmentEnded,
  resultError,
  today,
  warnsWorker,
} from "@/lib/domain";
import { guard, identity } from "@/lib/local-request";
import { readImportSources, resolveImportSourceRow } from "@/lib/import-source-store";
import {
  WORKER_FIELDS,
  ASSIGNMENT_FIELDS,
  cleanFields,
  validateWorker,
  phoneKey,
  validateInterview,
} from "@/lib/worker-validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const params = request.nextUrl.searchParams,
      search = params.get("search")?.trim() || "";
    const workers = await prisma.worker.findMany({
      where: search
        ? {
            archivedAt:
              params.get("archived") === "true" ? { not: null } : null,
            OR: ["fullName", "idCard", "phone", "code", "recruiter"].map(
              (field) => ({ [field]: { contains: search } }),
            ),
          }
        : {
            archivedAt:
              params.get("archived") === "true" ? { not: null } : null,
          },
      include: {
        assignments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        bankAccounts: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      success: true,
      data: workers.filter((w) =>
        w.assignments.some(
          (a) =>
            matchesAssignment({ ...a, worker: w }, params) &&
            (!params.get("factory") ||
              a.interviewFactory === params.get("factory")) &&
            (!params.get("status") || a.status === params.get("status")),
        ),
      ),
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể tải hồ sơ" },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  let body: any,
    worker: Record<string, string>,
    assignment: Record<string, string>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object")
      throw new Error("Dữ liệu không hợp lệ");
    worker = cleanFields(body, WORKER_FIELDS);
    worker.idCard = typeof body.idCard === "string" ? body.idCard.trim() : "";
    assignment = cleanFields(body, ASSIGNMENT_FIELDS);
    assignment.status ||= "Đang chờ phỏng vấn";
    validateWorker(worker, assignment);
    validateInterview(assignment);
    for (const f of ["orderId", "batchId"])
      if (!assignment[f]) delete assignment[f];
    assignment.team ??= worker.team || "";
    if (
      ![
        "Đã nghỉ việc",
        "Nghỉ hẳn",
        "Hết hợp đồng",
        "Bỏ xưởng",
        "Bỏ vì sức khỏe",
        "Hết phí",
      ].includes(assignment.status)
    ) {
      assignment.leaveDate = "";
      assignment.leaveReason = "";
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 400 },
    );
  }
  const actor = (await identity(request))!;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await assignmentRelations(tx, assignment);
      const existing = await tx.worker.findUnique({
        where: { idCard: worker.idCard },
        include: {
          assignments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        },
      });
      if (existing) {
        if (existing.archivedAt)
          return {
            status: 409,
            body: {
              success: false,
              message:
                "Hồ sơ đang lưu trữ. Khôi phục trước khi thêm đợt tuyển.",
            },
          };
        if (existing.isBlacklisted)
          return {
            status: 409,
            body: {
              success: false,
              message: "Hồ sơ đang hạn chế, cần quản trị viên xác minh",
            },
          };
        if (
          identityText(existing.fullName) !== identityText(worker.fullName)
        )
          return {
            status: 409,
            body: {
              success: false,
              message:
                "Tên không khớp CCCD cũ; xác minh và sửa hồ sơ trước khi tiếp tục",
            },
          };
        if (await assignmentEnded(tx, assignment.status))
          return {
            status: 400,
            body: {
              success: false,
              message: "Đợt tuyển mới không được bắt đầu ở trạng thái kết thúc",
            },
          };
        assertDailyInterview(existing, assignment);
        if (
          (await warnsWorker(tx, existing)) &&
          body.confirmActiveDuplicate !== true
        )
          return {
            status: 409,
            body: {
              success: false,
              isDuplicate: true,
              duplicateType: "ACTIVE_LABOR",
              existingWorkerId: existing.id,
              message:
                "CCCD đang có đợt Đang làm việc/Chưa đào tạo. Xem lịch sử và xác nhận trước khi thêm đợt mới.",
            },
          };
        const a = await tx.workAssignment.create({
          data: {
            ...assignment,
            workerId: existing.id,
            interviewFactory: assignment.interviewFactory,
          },
        });
        await tx.assignmentEvent.create({
          data: {
            assignmentId: a.id,
            occurredOn: today(),
            toStatus: a.status,
            interviewResult: a.interviewResult,
            operator: actor.username,
            note: "Tạo đợt mới; giữ lịch sử cũ",
          },
        });
        await tx.auditLog.create({
          data: {
            action: "REHIRE",
            module: "WORKER",
            operator: actor.username,
            details: `Tái tuyển hồ sơ ${existing.id}, đợt ${a.id}`,
          },
        });
        return {
          status: 201,
          body: {
            success: true,
            data: await tx.worker.findUnique({
              where: { id: existing.id },
              include: {
                assignments: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                },
              },
            }),
          },
        };
      }
      if (body.rehire === true)
        return {
          status: 404,
          body: { success: false, message: "Không tìm thấy CCCD để tái tuyển" },
        };
      if (worker.phone) {
        const others = await tx.worker.findMany({
          where: { phone: { not: null }, archivedAt: null },
          include: { assignments: true },
        });
        const activeOthers = [];
        for (const w of others)
          if (await warnsWorker(tx, w)) activeOthers.push(w);
        if (
          activeOthers.some((w) => phoneKey(w.phone!) === worker.phone) &&
          body.confirmPhoneDuplicate !== true
        )
          return {
            status: 409,
            body: {
              success: false,
              isDuplicate: true,
              duplicateType: "PHONE",
              message:
                "SĐT đã có trong hồ sơ khác. Chỉ tiếp tục sau khi xác minh và xác nhận dùng chung số.",
            },
          };
      }
      assertDailyInterview(null, assignment);
      const data = await tx.worker.create({
        data: {
          ...worker,
          fullName: worker.fullName,
          idCard: worker.idCard,
          assignments: {
            create: {
              ...assignment,
              interviewFactory: assignment.interviewFactory,
            },
          },
        },
        include: { assignments: true },
      });
      await tx.assignmentEvent.create({
        data: {
          assignmentId: data.assignments[0].id,
          occurredOn: today(),
          toStatus: assignment.status,
          interviewResult: assignment.interviewResult || "UNKNOWN",
          operator: actor.username,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          module: "WORKER",
          operator: actor.username,
          details: `Tạo hồ sơ ${data.id}${body.confirmPhoneDuplicate === true ? " (đã xác nhận SĐT trùng)" : ""}`,
        },
      });
      return { status: 201, body: { success: true, data } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    return resultError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const actor = await identity(request);

    if (body.isSourceRow === true) {
      const sourceId = String(body.sourceId || "");
      const sourceRow = Number(body.sourceRow);
      if (!/^[a-f0-9-]{36}$/i.test(sourceId) || !Number.isInteger(sourceRow) || sourceRow < 1)
        return NextResponse.json(
          { success: false, message: "Thiếu mã nguồn hoặc số dòng hợp lệ" },
          { status: 400 },
        );

      const source = (await readImportSources()).find((item) => item.id === sourceId);
      if (!source || !source.rows.some((row: any) => Number(row.row) === sourceRow))
        return NextResponse.json(
          { success: false, message: "Không tìm thấy dòng nguồn; hãy tải lại danh sách" },
          { status: 404 },
        );

      await resolveImportSourceRow(sourceId, sourceRow, "DELETE");
      if (actor)
        await prisma.auditLog.create({
          data: {
            module: "WORKER",
            action: "DELETE_SOURCE_ROW",
            operator: actor.username,
            details: `Xóa dòng nguồn ${source.file}, dòng ${sourceRow}; không xóa hồ sơ chuẩn`,
          },
        });
      return NextResponse.json({
        success: true,
        message: "Đã xóa dòng nguồn; hồ sơ và lịch sử trong hệ thống được giữ nguyên",
      });
    }

    let workerId = body.workerId;
    let assignmentId = body.assignmentId || body.assignments?.[0]?.id;

    // 1. Nếu chưa có workerId nhưng có idCard (CCCD), tìm kiếm worker trong DB Prisma
    if (!workerId && body.idCard) {
      const w = await prisma.worker.findUnique({
        where: { idCard: body.idCard },
        include: { assignments: true },
      });
      if (w) {
        workerId = w.id;
        if (!assignmentId && w.assignments.length > 0) {
          assignmentId = w.assignments[0].id;
        }
      }
    }

    // 2. Tiến hành xóa trong Database Prisma nếu tồn tại bản ghi
    if (workerId || assignmentId) {
      await prisma.$transaction(async (tx) => {
        if (assignmentId) {
          await tx.bonusRecord.deleteMany({ where: { assignmentId } });
          await tx.assignmentEvent.deleteMany({ where: { assignmentId } });
          await tx.workAssignment.delete({ where: { id: assignmentId } });
        }

        if (workerId) {
          const remaining = await tx.workAssignment.count({
            where: { workerId },
          });
          if (remaining === 0) {
            await tx.bankAccount.deleteMany({ where: { workerId } });
            await tx.worker.delete({ where: { id: workerId } });
          }
        }

        if (actor) {
          await tx.auditLog.create({
            data: {
              module: "WORKER",
              action: "DELETE",
              operator: actor.username,
              details: `Xóa hồ sơ worker:${workerId || ""} assignment:${assignmentId || ""}`,
            },
          });
        }
      });
    } else {
      // 3. Trường hợp dòng dữ liệu nguồn import chưa vào DB: Ghi audit log xóa
      if (actor) {
        await prisma.auditLog.create({
          data: {
            module: "WORKER",
            action: "DELETE",
            operator: actor.username,
            details: `Xóa dòng dữ liệu nguồn import CCCD: ${body.idCard || "N/A"}`,
          },
        });
      }
    }

    return NextResponse.json({ success: true, message: "Đã xóa hồ sơ thành công" });
  } catch (error: any) {
    return resultError(error);
  }
}
