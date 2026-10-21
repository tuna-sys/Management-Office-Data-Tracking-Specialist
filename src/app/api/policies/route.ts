import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, identity } from "@/lib/local-request";
import { text, day, DomainError, resultError, rulesOf } from "@/lib/domain";
export const dynamic = "force-dynamic";
export async function GET(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    return NextResponse.json({
      success: true,
      data: await prisma.bonusPolicy.findMany({
        include: { order: true, factoryEntry: true },
        orderBy: { createdAt: "desc" },
      }),
    });
  } catch (e) {
    return resultError(e);
  }
}
async function save(r: NextRequest, edit: boolean) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const b = await r.json(),
      actor = (await identity(r))!,
      name = text(b.name, "tên chính sách"),
      factoryId = text(b.factoryId, "nhà máy"),
      rules = rulesOf(b.rules);
    const from = b.effectiveFrom ? day(b.effectiveFrom, "ngày bắt đầu") : null,
      to = b.effectiveTo ? day(b.effectiveTo, "ngày kết thúc") : null;
    if (!!from !== !!to || (from && to && from > to))
      throw new DomainError(
        "Cần đủ khoảng ngày hiệu lực, kết thúc không trước bắt đầu",
      );
    if (typeof b.isActive !== "boolean")
      throw new DomainError("Trạng thái chính sách không hợp lệ");
    const data = await prisma.$transaction(async (tx) => {
      const factoryRow = await tx.factory.findUnique({ where: { id: factoryId } });
      if (!factoryRow || !factoryRow.isActive)
        throw new DomainError("Nhà máy không tồn tại hoặc đã ngừng dùng");
      const factory = factoryRow.name;
      if (b.orderId) {
        const order = await tx.recruitmentOrder.findUnique({
          where: { id: b.orderId },
        });
        if (!order || (order.factoryId ? order.factoryId !== factoryId : order.factory !== factory))
          throw new DomainError("Đơn hàng không thuộc nhà máy của chính sách");
      }
      if (edit) {
        const old = await tx.bonusPolicy.findUnique({
          where: { id: b.id || "" },
        });
        if (!old) throw new DomainError("Không tìm thấy chính sách", 404);
        if (b.updatedAt !== old.updatedAt.toISOString())
          throw new DomainError("Chính sách đã thay đổi, tải lại", 409);
      }
      const values = {
        name,
        factory,
        factoryId,
        rulesJson: JSON.stringify(rules),
        effectiveFrom: from,
        effectiveTo: to,
        orderId: b.orderId || null,
        isActive: b.isActive,
        description: text(b.description, "ghi chú", false, 2000) || null,
      };
      const policy = edit
        ? await tx.bonusPolicy.update({ where: { id: b.id }, data: values })
        : await tx.bonusPolicy.create({ data: values });
      await tx.auditLog.create({
        data: {
          module: "BONUS",
          action: edit ? "UPDATE" : "CREATE",
          operator: actor.username,
          details: `Chính sách ${policy.id}; giữ snapshot các đợt đã áp dụng`,
        },
      });
      return policy;
    });
    return NextResponse.json(
      { success: true, data },
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
    const data = await prisma.$transaction(async (tx) => {
      const old = await tx.bonusPolicy.findUnique({
        where: { id: text(b.id, "chính sách") },
      });
      if (!old) throw new DomainError("Không tìm thấy chính sách", 404);
      if (old.updatedAt.toISOString() !== b.updatedAt)
        throw new DomainError("Chính sách đã thay đổi", 409);
      const row = await tx.bonusPolicy.update({
        where: { id: old.id },
        data: { isActive: false },
      });
      await tx.auditLog.create({
        data: {
          module: "BONUS",
          action: "ARCHIVE_POLICY",
          operator: actor.username,
          details: `Ngừng dùng chính sách ${old.id}; giữ thưởng đã áp dụng`,
        },
      });
      return row;
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return resultError(e);
  }
}
