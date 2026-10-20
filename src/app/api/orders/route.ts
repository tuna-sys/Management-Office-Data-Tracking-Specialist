import { NextRequest, NextResponse } from "next/server";
import { guard, identity } from "@/lib/local-request";
import { prisma } from "@/lib/prisma";
import { text, day, DomainError, resultError } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    return NextResponse.json({
      success: true,
      data: await prisma.recruitmentOrder.findMany({
        include: {
          batches: { orderBy: { startDate: "desc" } },
          _count: { select: { assignments: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    });
  } catch (e) {
    return resultError(e);
  }
}

async function save(request: NextRequest, edit: boolean) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = await request.json(),
      actor = (await identity(request))!;
    const output = await prisma.$transaction(async (tx) => {
      if (body.kind === "BATCH") {
        const orderId = text(body.orderId, "đơn hàng"),
          code = text(body.code, "mã đợt"),
          name = text(body.name, "tên đợt"),
          startDate = day(body.startDate, "ngày bắt đầu"),
          endDate = day(body.endDate, "ngày kết thúc");
        if (
          body.periodMonth &&
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.periodMonth)
        )
          throw new DomainError("Kỳ tuyển không hợp lệ");
        if (startDate > endDate)
          throw new DomainError("Ngày kết thúc trước ngày bắt đầu");
        if (!(await tx.recruitmentOrder.findUnique({ where: { id: orderId } })))
          throw new DomainError("Không tìm thấy đơn hàng", 404);
        if (
          body.target != null &&
          (!Number.isInteger(body.target) || body.target < 0)
        )
          throw new DomainError("Chỉ tiêu phải là số nguyên không âm");
        if (edit) {
          const current = await tx.recruitmentBatch.findUnique({
            where: { id: body.id || "" },
            include: { _count: { select: { assignments: true } } },
          });
          if (!current) throw new DomainError("Không tìm thấy đợt", 404);
          if (current.updatedAt.toISOString() !== body.updatedAt)
            throw new DomainError("Đợt đã thay đổi, tải lại", 409);
          if (
            current._count.assignments &&
            [
              current.orderId !== orderId,
              current.startDate !== startDate,
              current.endDate !== endDate,
            ].some(Boolean)
          )
            throw new DomainError(
              "Đợt đã có hồ sơ: không thay đơn hàng hoặc khoảng ngày",
              409,
            );
        }
        const data = {
          orderId,
          code,
          name,
          startDate,
          endDate,
          periodMonth: body.periodMonth || null,
          target: body.target ?? null,
        };
        const row = edit
          ? await tx.recruitmentBatch.update({ where: { id: body.id }, data })
          : await tx.recruitmentBatch.create({ data });
        await tx.auditLog.create({
          data: {
            action: edit ? "UPDATE" : "CREATE",
            module: "ORDER",
            operator: actor.username,
            details: `Đợt tuyển ${row.id} thuộc đơn hàng ${orderId}`,
          },
        });
        return row;
      }
      const code = text(body.code, "mã đơn hàng"),
        name = text(body.name, "tên đơn hàng"),
        factory = text(body.factory, "nhà máy");
      if (typeof body.isActive !== "boolean")
        throw new DomainError("Cần trạng thái đơn hàng");
      if (edit) {
        const current = await tx.recruitmentOrder.findUnique({
          where: { id: body.id || "" },
          include: {
            _count: { select: { assignments: true, policies: true } },
          },
        });
        if (!current) throw new DomainError("Không tìm thấy đơn hàng", 404);
        if (current.updatedAt.toISOString() !== body.updatedAt)
          throw new DomainError("Đơn hàng đã thay đổi, tải lại", 409);
        if (
          (current._count.assignments || current._count.policies) &&
          current.factory !== factory
        )
          throw new DomainError("Đơn hàng đã sử dụng: không đổi nhà máy", 409);
      }
      if (body.factoryId) {
        const entry = await tx.factory.findUnique({
          where: { id: body.factoryId },
        });
        if (!entry || !entry.isActive || entry.name !== factory)
          throw new DomainError("Danh mục nhà máy không hợp lệ");
      }
      const data = {
        code,
        name,
        factory,
        factoryId: body.factoryId || null,
        isActive: body.isActive,
      };
      const row = edit
        ? await tx.recruitmentOrder.update({ where: { id: body.id }, data })
        : await tx.recruitmentOrder.create({ data });
      await tx.auditLog.create({
        data: {
          action: edit ? "UPDATE" : "CREATE",
          module: "ORDER",
          operator: actor.username,
          details: `Đơn hàng ${row.id} — ${factory}`,
        },
      });
      return row;
    });
    return NextResponse.json(
      { success: true, data: output },
      { status: edit ? 200 : 201 },
    );
  } catch (e) {
    return resultError(e);
  }
}

export const POST = (r: NextRequest) => save(r, false);
export const PUT = (r: NextRequest) => save(r, true);

export async function DELETE(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const b = await r.json(),
      actor = (await identity(r))!;

    // 1. Xóa Đợt tuyển (BATCH)
    if (b.kind === "BATCH") {
      const row = await prisma.$transaction(async (tx) => {
        const batch = await tx.recruitmentBatch.findUnique({
          where: { id: b.id || "" },
          include: { _count: { select: { assignments: true } } },
        });
        if (!batch) throw new DomainError("Không tìm thấy đợt tuyển", 404);
        if (batch._count.assignments > 0) {
          throw new DomainError("Đợt đã có hồ sơ, không thể xóa", 409);
        }
        const data = await tx.recruitmentBatch.delete({
          where: { id: batch.id },
        });
        await tx.auditLog.create({
          data: {
            module: "ORDER",
            action: "DELETE",
            operator: actor.username,
            details: `Xóa đợt tuyển ${batch.id}`,
          },
        });
        return data;
      });
      return NextResponse.json({ success: true, data: row });
    }

    // 2. Xóa cứng Đơn hàng (Hard Delete)
    if (b.forceDelete) {
      const row = await prisma.$transaction(async (tx) => {
        const old = await tx.recruitmentOrder.findUnique({
          where: { id: b.id || "" },
          include: { _count: { select: { assignments: true, batches: true } } },
        });
        if (!old) throw new DomainError("Không tìm thấy đơn hàng", 404);
        if (old._count.assignments > 0 || old._count.batches > 0) {
          throw new DomainError(
            "Đơn hàng đã có đợt tuyển hoặc hồ sơ, không thể xóa hẳn",
            409,
          );
        }
        const data = await tx.recruitmentOrder.delete({
          where: { id: old.id },
        });
        await tx.auditLog.create({
          data: {
            module: "ORDER",
            action: "DELETE",
            operator: actor.username,
            details: `Xóa đơn hàng ${old.id}`,
          },
        });
        return data;
      });
      return NextResponse.json({ success: true, data: row });
    }

    // 3. Ngừng đơn hàng (Soft Delete / Archive)
    const row = await prisma.$transaction(async (tx) => {
      const old = await tx.recruitmentOrder.findUnique({
        where: { id: b.id || "" },
      });
      if (!old) throw new DomainError("Không tìm thấy đơn hàng", 404);
      if (old.updatedAt.toISOString() !== b.updatedAt)
        throw new DomainError("Đơn hàng đã thay đổi", 409);
      const data = await tx.recruitmentOrder.update({
        where: { id: old.id },
        data: { isActive: false },
      });
      await tx.auditLog.create({
        data: {
          module: "ORDER",
          action: "ARCHIVE",
          operator: actor.username,
          details: `Ngừng đơn hàng ${old.id}`,
        },
      });
      return data;
    });
    return NextResponse.json({ success: true, data: row });
  } catch (e) {
    return resultError(e);
  }
}
