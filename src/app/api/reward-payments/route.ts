import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, identity } from "@/lib/local-request";
import { DomainError, day, text, today, resultError } from "@/lib/domain";
export async function POST(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const b = await r.json(),
      actor = (await identity(r))!;
    if (b.confirmActualPayment !== true)
      throw new DomainError(
        "Cần xác nhận đã chi tiền thực tế; thao tác này không chuyển tiền",
      );
    if (
      !Number.isSafeInteger(b.amount) ||
      b.amount <= 0 ||
      b.amount > 2147483647
    )
      throw new DomainError("Số tiền thực trả không hợp lệ");
    const paidOn = day(b.paidOn, "ngày trả tiền"),
      reference = text(b.reference, "mã chứng từ", true, 100);
    const data = await prisma.$transaction(async (tx) => {
      const s = await tx.rewardStage.findUnique({
        where: { id: text(b.stageId, "mốc thưởng") },
        include: { payments: true },
      });
      if (!s) throw new DomainError("Không tìm thấy mốc", 404);
      if (!s.eligible || !s.achieved || !s.achievedOn)
        throw new DomainError("Mốc chưa xác nhận đủ điều kiện và đạt");
      if (paidOn < s.achievedOn || paidOn > today())
        throw new DomainError("Ngày chi trả phải từ ngày đạt mốc đến hiện tại");
      const sum = s.payments.reduce((n, p) => n + p.amount, 0);
      if (sum + b.amount > s.amount)
        throw new DomainError("Tổng đã trả không được vượt số tiền mốc", 409);
      const row = await tx.rewardPayment.create({
        data: {
          stageId: s.id,
          amount: b.amount,
          paidOn,
          reference,
          note: text(b.note, "ghi chú", false, 1000) || null,
          confirmedBy: actor.username,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CONFIRM_PAYMENT",
          module: "BONUS",
          operator: actor.username,
          details: `Xác nhận đã chi ${b.amount} VND cho mốc ${s.id}, chứng từ ${reference}`,
        },
      });
      return row;
    });
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (e) {
    return resultError(e);
  }
}
