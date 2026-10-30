import { isActiveAssignment } from "@/lib/duplicate-check";
import { NextResponse } from "next/server";
import { dateKey } from "@/lib/worker-validation";
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function text(
  value: unknown,
  label: string,
  required = true,
  max = 200,
): string {
  if (value === undefined || value === null) {
    if (required) throw new DomainError(`Cần ${label}`);
    return "";
  }
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    throw new DomainError(`${label} không hợp lệ`);
  return value.trim();
}
export function day(value: unknown, label: string, required = true): string {
  const s = text(value, label, required, 30);
  if (!s && !required) return "";
  const parsed = dateKey(s);
  if (!parsed) throw new DomainError(`${label} không hợp lệ`);
  return parsed;
}
export function resultError(error: any) {
  return NextResponse.json(
    {
      success: false,
      message:
        error instanceof DomainError
          ? error.message
          : error?.code === "P2002"
            ? "Mã hoặc bản ghi đã tồn tại"
            : /Trùng lặp nội bộ|Trùng ngày PV tại hai công ty|Khác mã theo công ty|Sai lệch danh tính/.test(error?.message || "") ? error.message : "Không thể xử lý yêu cầu",
    },
    {
      status:
        error instanceof DomainError
          ? error.status
          : error?.code === "P2002"
            ? 409
            : /Trùng lặp nội bộ|Trùng ngày PV tại hai công ty|Khác mã theo công ty|Sai lệch danh tính/.test(error?.message || "") ? 409 : 500,
    },
  );
}
export function monthOf(value: string | null | undefined) {
  return value ? dateKey(value)?.slice(0, 7) || "UNKNOWN" : "UNKNOWN";
}
export function today() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function rulesOf(input: any) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 7)
    throw new DomainError("Chính sách cần từ 1 đến 7 mốc");
  return input.map((r: any, i: number) => {
    const label = text(r?.milestone, "tên mốc");
    const amount = r?.amount;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2147483647)
      throw new DomainError(
        "Tiền mỗi mốc phải là số nguyên không âm, tối đa 2.147.483.647 VND",
      );
    const thresholdDays =
      r?.thresholdDays == null || r.thresholdDays === ""
        ? null
        : Number(r.thresholdDays);
    if (
      thresholdDays !== null &&
      (!Number.isFinite(thresholdDays) ||
        thresholdDays < 0 ||
        thresholdDays > 10000)
    )
      throw new DomainError("Mốc công không hợp lệ");
    return { step: i + 1, milestone: label, amount, thresholdDays };
  });
}
export async function assignmentRelations(
  tx: any,
  assignment: any,
  existing?: any,
) {
  const findFactory = async (id: string | null, name: string | null) => {
    if (id) return tx.factory.findUnique({ where: { id } });
    if (!name) return null;
    const rows = await tx.factory.findMany();
    return rows.find((row: any) => row.name.trim().toLocaleLowerCase("vi") === name.trim().toLocaleLowerCase("vi")) || null;
  };
  const interviewFactory = await findFactory(
    assignment.interviewFactoryId || null,
    assignment.interviewFactory || null,
  );
  if (assignment.interviewFactoryId && !interviewFactory)
    throw new DomainError("Nhà máy phỏng vấn đã chọn không tồn tại");
  if (interviewFactory && !interviewFactory.isActive && existing?.interviewFactoryId !== interviewFactory.id && existing?.interviewFactory !== interviewFactory.name)
    throw new DomainError("Nhà máy phỏng vấn đã ngừng dùng");
  assignment.interviewFactoryId = interviewFactory?.id || null;
  assignment.interviewFactory = interviewFactory?.name || text(assignment.interviewFactory, "nhà máy phỏng vấn");

  // Working factory is optional source information, never an identity/eligibility condition.
  assignment.workingFactory = String(assignment.workingFactory || "").trim() || null;
  assignment.workingFactoryId = null;

  const status = assignment.statusId
    ? await tx.laborStatus.findUnique({ where: { id: assignment.statusId } })
    : await tx.laborStatus.findUnique({ where: { name: assignment.status } });
  if (!status || (!status.isActive && existing?.statusId !== status.id && existing?.status !== status.name))
    throw new DomainError("Trạng thái chưa có trong danh mục hoặc đã ngừng dùng");
  if (assignment.status && assignment.status !== status.name)
    throw new DomainError("Tên trạng thái không khớp danh mục trạng thái đã chọn");
  assignment.statusId = status.id;
  assignment.status = status.name;
  if (!assignment.recruiterId && assignment.recruiter) {
    const candidates = await tx.recruiter.findMany({ include: { team: true } });
    const matched = candidates.find((r: any) => r.name.trim().toLocaleLowerCase("vi") === assignment.recruiter.trim().toLocaleLowerCase("vi"));
    if (matched) assignment.recruiterId = matched.id;
  }
  if (assignment.recruiterId) {
    const recruiter = await tx.recruiter.findUnique({
      where: { id: assignment.recruiterId },
      include: { team: true },
    });
    if (
      !recruiter ||
      (!recruiter.isActive && existing?.recruiterId !== assignment.recruiterId)
    )
      throw new DomainError("Chuyên viên đã ngừng dùng hoặc không tồn tại");
    assignment.recruiter = recruiter.name;
    assignment.teamId = recruiter.teamId;
    assignment.team = recruiter.team?.name || "";
  }
  if (!assignment.teamId && assignment.team) {
    const teams = await tx.recruitmentTeam.findMany();
    const matched = teams.find((t: any) => t.name.trim().toLocaleLowerCase("vi") === assignment.team.trim().toLocaleLowerCase("vi"));
    if (matched) assignment.teamId = matched.id;
  }
  if (assignment.teamId && !assignment.recruiterId) {
    const team = await tx.recruitmentTeam.findUnique({
      where: { id: assignment.teamId },
    });
    if (!team || (!team.isActive && existing?.teamId !== assignment.teamId))
      throw new DomainError("Team không hợp lệ");
    if (!existing || existing.teamId !== assignment.teamId)
      assignment.team = team.name;
  }

  const orderId = assignment.orderId || null,
    batchId = assignment.batchId || null;
  if (batchId && !orderId)
    throw new DomainError("Cần chọn đơn hàng trước đợt tuyển");
  if (orderId) {
    const order = await tx.recruitmentOrder.findUnique({
      where: { id: orderId },
    });
    if (!order || (!order.isActive && existing?.orderId !== orderId))
      throw new DomainError("Đơn hàng không tồn tại hoặc đã ngừng tuyển");
    if (
      (order.factoryId && order.factoryId !== assignment.interviewFactoryId) ||
      (!order.factoryId && order.factory !== assignment.interviewFactory)
    )
      throw new DomainError("Nhà máy PV không khớp đơn hàng");
  }
  if (batchId) {
    const batch = await tx.recruitmentBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch || batch.orderId !== orderId)
      throw new DomainError("Đợt tuyển không thuộc đơn hàng");
    const interview = dateKey(assignment.interviewDate || "");
    if (!interview || interview < batch.startDate || interview > batch.endDate)
      throw new DomainError("Ngày PV phải trong thời hạn đợt tuyển");
  }
}

export async function assignmentEnded(tx: any, name: string): Promise<boolean> {
  const status = await tx.laborStatus.findUnique({ where: { name } });
  return status?.endsAssignment === true;
}

export async function warnsWorker(tx: any, worker: any) {
  const statuses = await tx.laborStatus.findMany({
    where: { isActive: true },
  });
  return worker.assignments.some((a: any) => isActiveAssignment(a, statuses));
}
