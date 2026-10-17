import { guard, identity } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canTransition, validAmount, validMonth } from "@/lib/payment-safety";
import { dateKey } from "@/lib/worker-validation";

function filterValues(params: URLSearchParams, key: string) {
  return [
    ...new Set(
      params
        .getAll(key)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export async function GET(request: NextRequest) {
  const denied = await guard(request, "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const months = filterValues(searchParams, "month");
    const companies = filterValues(searchParams, "company");
    const status = searchParams.get("status") || "";
    const idCard = searchParams.get("idCard")?.trim() || "";
    const workerCode = searchParams.get("workerCode")?.trim() || "";
    const search = searchParams.get("search")?.trim() || "";

    const whereClause: any = {};
    if (months.length === 1) whereClause.month = months[0];
    else if (months.length > 1) whereClause.month = { in: months };
    if (companies.length === 1) whereClause.company = companies[0];
    else if (companies.length > 1) whereClause.company = { in: companies };
    if (status) whereClause.status = status;
    if (workerCode) {
      whereClause.workerCode = { contains: workerCode };
    }
    if (idCard) {
      whereClause.worker = {
        is: {
          idCard: { contains: idCard },
        },
      };
    }
    if (search) {
      whereClause.OR = [
        { workerCode: { contains: search } },
        { worker: { is: { idCard: { contains: search } } } },
        { worker: { is: { fullName: { contains: search } } } },
      ];
    }
    const bonuses = await prisma.bonusRecord.findMany({
      where: whereClause,
      include: {
        worker: {
          include: {
            bankAccounts: { orderBy: { createdAt: "desc" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: bonuses });
  } catch (error: any) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 },
      );
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  const denied = await guard(request, "bonus:write");
  if (denied) return denied;
  try {
    const body = await request.json();
    const workerId = body?.workerId;
    const assignmentId = body?.assignmentId;
    const {
      company,
      month,
      interviewDate,
      policy,
      workerCode,
      accountNumber,
      bankName,
    } = body || {};
    const amounts = Array.from(
      { length: 7 },
      (_, index) => body?.[`bonus${index + 1}`] ?? 0,
    );
    if (
      !body ||
      typeof workerId !== "string" ||
      !workerId.trim() ||
      !validMonth(month) ||
      typeof company !== "string" ||
      !company.trim() ||
      company.trim().length > 200 ||
      (assignmentId !== undefined &&
        assignmentId !== null &&
        typeof assignmentId !== "string") ||
      (interviewDate !== undefined &&
        interviewDate !== null &&
        (typeof interviewDate !== "string" || interviewDate.length > 100)) ||
      (interviewDate && !dateKey(interviewDate)) ||
      (policy !== undefined &&
        policy !== null &&
        (typeof policy !== "string" || policy.length > 1000)) ||
      (workerCode !== undefined &&
        workerCode !== null &&
        (typeof workerCode !== "string" || workerCode.length > 100)) ||
      (accountNumber !== undefined &&
        accountNumber !== null &&
        (typeof accountNumber !== "string" || accountNumber.length > 100)) ||
      (bankName !== undefined &&
        bankName !== null &&
        (typeof bankName !== "string" || bankName.length > 200)) ||
      !amounts.every(validAmount)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Lao động, kỳ tháng hoặc số tiền thưởng không hợp lệ",
        },
        { status: 400 },
      );
    }
    const totalBonus = amounts.reduce((sum, amount) => sum + amount, 0);
    if (!validAmount(totalBonus))
      return NextResponse.json(
        {
          success: false,
          message: "Tổng thưởng vượt giới hạn số nguyên an toàn",
        },
        { status: 400 },
      );
    const actor = (await identity(request))!;
    const record = await prisma.$transaction(async (tx) => {
      const worker = await tx.worker.findUnique({
        where: { id: workerId },
        include: {
          assignments: true,
          bankAccounts: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!worker) throw new Error("BONUS_WORKER_MISSING");
      const assignment = assignmentId
        ? worker.assignments.find((item) => item.id === assignmentId)
        : null;
      if (assignmentId && !assignment)
        throw new Error("BONUS_ASSIGNMENT_CHANGED");
      const fallbackBank = worker.bankAccounts[0];
      const resolvedCompany =
        company.trim() ||
        assignment?.workingFactory ||
        assignment?.interviewFactory ||
        "";
      const resolvedInterviewDate = (
        interviewDate ||
        assignment?.interviewDate ||
        ""
      ).trim();
      if (
        !resolvedCompany ||
        (resolvedInterviewDate && !dateKey(resolvedInterviewDate))
      )
        throw new Error("BONUS_FIELDS_INVALID");
      if (
        await tx.bonusRecord.findFirst({
          where: {
            workerId,
            month,
            company: resolvedCompany,
            ...(assignment
              ? {
                  OR: [{ assignmentId: assignment.id }, { assignmentId: null }],
                }
              : { assignmentId: null }),
          },
        })
      )
        throw new Error("BONUS_ALREADY_EXISTS");
      const created = await tx.bonusRecord.create({
        data: {
          workerId,
          assignmentId: assignment?.id || null,
          company: resolvedCompany,
          month,
          interviewDate: resolvedInterviewDate || null,
          policy:
            typeof policy === "string" && policy.trim() ? policy.trim() : null,
          workerCode:
            typeof workerCode === "string" && workerCode.trim()
              ? workerCode.trim()
              : assignment?.employeeCode || worker.code || null,
          accountNumber:
            typeof accountNumber === "string" && accountNumber.trim()
              ? accountNumber.trim()
              : fallbackBank?.accountNumber || null,
          bankName:
            typeof bankName === "string" && bankName.trim()
              ? bankName.trim()
              : fallbackBank?.bankName || null,
          ...Object.fromEntries(
            amounts.map((amount, index) => [`bonus${index + 1}`, amount]),
          ),
          totalBonus,
          status: "DRAFT",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          module: "BONUS",
          operator: actor.username,
          details: `Tạo dự thảo thưởng kỳ ${month} cho công nhân - Tổng tiền: ${totalBonus.toLocaleString("vi-VN")} đ`,
        },
      });
      return created;
    });
    return NextResponse.json({ success: true, data: record }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 },
      );
    if (error.message === "BONUS_ALREADY_EXISTS")
      return NextResponse.json(
        {
          success: false,
          message:
            "Đợt tuyển này đã có thưởng trong kỳ. Hãy sửa dự thảo hiện có.",
        },
        { status: 409 },
      );
    if (error.message === "BONUS_ASSIGNMENT_CHANGED")
      return NextResponse.json(
        {
          success: false,
          message: "Đợt tuyển dụng đã thay đổi. Tải lại danh sách lao động.",
        },
        { status: 409 },
      );
    if (error.message === "BONUS_WORKER_MISSING")
      return NextResponse.json(
        {
          success: false,
          message: "Không tìm thấy lao động hoặc đợt tuyển dụng",
        },
        { status: 404 },
      );
    if (error.message === "BONUS_FIELDS_INVALID")
      return NextResponse.json(
        {
          success: false,
          message: "Thông tin công ty hoặc ngày PV không hợp lệ",
        },
        { status: 400 },
      );
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
export async function PUT(request: NextRequest) {
  const denied = await guard(request, "bonus:approve");
  if (denied) return denied;
  try {
    const body = await request.json();
    const { id, status } = body || {};
    const approver = (await identity(request))!.username;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      !["APPROVED", "LOCKED"].includes(status) ||
      typeof approver !== "string" ||
      !approver.trim() ||
      approver.trim().length > 100
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Cần mã bản ghi, trạng thái hợp lệ và tên người thao tác",
        },
        { status: 400 },
      );
    }
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.bonusRecord.findUnique({ where: { id } });
      if (!current)
        return { error: "Không tìm thấy bản ghi thưởng", status: 404 };
      if (!canTransition(current.status, status))
        return {
          error:
            "Chỉ được duyệt dự thảo và khóa bản ghi đã duyệt. Không được sửa bản ghi đã khóa.",
          status: 409,
        };
      const amounts = [
        current.bonus1,
        current.bonus2,
        current.bonus3,
        current.bonus4,
        current.bonus5,
        current.bonus6,
        current.bonus7,
      ].map((n) => n ?? 0);
      if (
        !amounts.every(validAmount) ||
        amounts.reduce((sum, n) => sum + n, 0) !== current.totalBonus
      )
        return {
          error: "Chi tiết thưởng không khớp tổng tiền, cần sửa dự thảo",
          status: 409,
        };
      if (!validAmount(current.totalBonus) || current.totalBonus === 0)
        return {
          error: "Tổng thưởng phải là số nguyên dương hợp lệ",
          status: 400,
        };
      if (
        status === "LOCKED" &&
        (!current.approvedBy?.trim() || !current.approvedAt)
      )
        return { error: "Thiếu thông tin phê duyệt để khóa sổ", status: 409 };
      const changed = await tx.bonusRecord.updateMany({
        where: { id, status: current.status, updatedAt: current.updatedAt },
        data: {
          status,
          ...(status === "APPROVED"
            ? { approvedBy: approver.trim(), approvedAt: new Date() }
            : {}),
        },
      });
      if (changed.count !== 1)
        return { error: "Bản ghi đã thay đổi, vui lòng tải lại", status: 409 };
      await tx.auditLog.create({
        data: {
          action: status === "LOCKED" ? "LOCK" : "APPROVE",
          module: "BONUS",
          operator: approver.trim(),
          details: `Bản ghi ${id}: ${current.status} → ${status}. Người thao tác đã đăng nhập.`,
        },
      });
      return { data: await tx.bonusRecord.findUnique({ where: { id } }) };
    });
    if ("error" in result)
      return NextResponse.json(
        { success: false, message: result.error },
        { status: result.status },
      );
    const updated = result.data;
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 },
      );
    return NextResponse.json(
      { success: false, message: "Không thể xử lý yêu cầu lúc này" },
      { status: 500 },
    );
  }
}
export async function PATCH(request: NextRequest) {
  const denied = await guard(request, "bonus:write");
  if (denied) return denied;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "JSON không hợp lệ" },
      { status: 400 },
    );
  }
  const amounts = Array.from({ length: 7 }, (_, i) => body?.[`bonus${i + 1}`]);
  const limits: Record<string, number> = {
    company: 200,
    interviewDate: 100,
    policy: 1000,
    workerCode: 100,
    accountNumber: 100,
    bankName: 200,
  };
  if (
    typeof body?.id !== "string" ||
    !amounts.every(validAmount) ||
    !validAmount(amounts.reduce((sum, n) => sum + n, 0)) ||
    Object.entries(limits).some(
      ([field, limit]) =>
        body[field] !== undefined &&
        body[field] !== null &&
        (typeof body[field] !== "string" || body[field].length > limit),
    ) ||
    (body.interviewDate && !dateKey(body.interviewDate))
  )
    return NextResponse.json(
      { success: false, message: "Chi tiết thưởng không hợp lệ" },
      { status: 400 },
    );
  const actor = (await identity(request))!;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.bonusRecord.findUnique({
        where: { id: body.id },
      });
      if (!current) return { error: "Không tìm thấy thưởng", status: 404 };
      if (current.status !== "DRAFT")
        return { error: "Chỉ được sửa dự thảo", status: 409 };
      if (current.updatedAt.toISOString() !== body.updatedAt)
        return { error: "Bản ghi đã thay đổi, hãy tải lại", status: 409 };
      const data = await tx.bonusRecord.update({
        where: { id: current.id },
        data: {
          ...Object.fromEntries(amounts.map((n, i) => [`bonus${i + 1}`, n])),
          totalBonus: amounts.reduce((sum, n) => sum + n, 0),
          ...(body.company !== undefined
            ? { company: body.company.trim() || null }
            : {}),
          ...(body.interviewDate !== undefined
            ? { interviewDate: body.interviewDate.trim() || null }
            : {}),
          ...(body.policy !== undefined
            ? { policy: body.policy.trim() || null }
            : {}),
          ...(body.workerCode !== undefined
            ? { workerCode: body.workerCode.trim() || null }
            : {}),
          ...(body.accountNumber !== undefined
            ? { accountNumber: body.accountNumber.trim() || null }
            : {}),
          ...(body.bankName !== undefined
            ? { bankName: body.bankName.trim() || null }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          module: "BONUS",
          operator: actor.username,
          details: `Sửa dự thảo ${current.id}: ${current.totalBonus} → ${data.totalBonus} VND`,
        },
      });
      return { data };
    });
    if ("error" in result)
      return NextResponse.json(
        { success: false, message: result.error },
        { status: result.status },
      );
    return NextResponse.json({ success: true, data: result.data });
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể lưu dự thảo" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request, "bonus:write");
  if (denied) return denied;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "JSON không hợp lệ" },
      { status: 400 },
    );
  }
  const actor = (await identity(request))!;
  try {
    if (typeof body?.id === "string" && body.id.trim()) {
      const record = await prisma.bonusRecord.findUnique({
        where: { id: body.id },
      });
      if (!record)
        return NextResponse.json(
          { success: false, message: "Không tìm thấy bản thưởng" },
          { status: 404 },
        );
      await prisma.$transaction(async (tx) => {
        await tx.bonusRecord.delete({ where: { id: record.id } });
        await tx.auditLog.create({
          data: {
            action: "DELETE",
            module: "BONUS",
            operator: actor.username,
            details: `Xóa bản thưởng ${record.id}, CCCD worker ${record.workerId}, kỳ ${record.month}, công ty ${record.company || ""}`,
          },
        });
      });
      return NextResponse.json({ success: true, deletedCount: 1 });
    }
    if (body?.all !== true || body?.confirmAll !== true)
      return NextResponse.json(
        { success: false, message: "Cần xác nhận xóa toàn bộ bản thưởng" },
        { status: 400 },
      );
    const deletedCount = await prisma.$transaction(async (tx) => {
      const count = await tx.bonusRecord.count();
      await tx.bonusRecord.deleteMany();
      await tx.auditLog.create({
        data: {
          action: "DELETE",
          module: "BONUS",
          operator: actor.username,
          details: `Xóa toàn bộ ${count} bản ghi thưởng`,
        },
      });
      return count;
    });
    return NextResponse.json({ success: true, deletedCount });
  } catch {
    return NextResponse.json(
      { success: false, message: "Không thể xóa bản thưởng" },
      { status: 500 },
    );
  }
}
