import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, identity } from "@/lib/local-request";
import { text, DomainError, resultError } from "@/lib/domain";
export const dynamic = "force-dynamic";
const kinds = ["FACTORY", "TEAM", "RECRUITER", "STATUS", "IMPORT"];
function model(tx: any, kind: string) {
  return (
    {
      FACTORY: tx.factory,
      TEAM: tx.recruitmentTeam,
      RECRUITER: tx.recruiter,
      STATUS: tx.laborStatus,
      IMPORT: tx.importProfile,
    } as any
  )[kind];
}
export async function GET(r: NextRequest) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const kind = r.nextUrl.searchParams.get("kind") || "FACTORY";
    if (!kinds.includes(kind)) throw new DomainError("Danh mục không hợp lệ");
    return NextResponse.json({
      success: true,
      data: await model(prisma, kind).findMany({
        ...(kind === "RECRUITER" ? { include: { team: true } } : {}),
        orderBy: { name: "asc" },
      }),
    });
  } catch (e) {
    return resultError(e);
  }
}
async function save(r: NextRequest, method: string) {
  const denied = await guard(r);
  if (denied) return denied;
  try {
    const b = await r.json(),
      kind = text(b.kind, "loại danh mục"),
      actor = (await identity(r))!;
    if (!kinds.includes(kind)) throw new DomainError("Danh mục không hợp lệ");
    const data = await prisma.$transaction(async (tx) => {
      const table = model(tx, kind);
      let current: any;
      if (method !== "POST") {
        current = await table.findUnique({
          where: { id: text(b.id, "mã bản ghi") },
        });
        if (!current) throw new DomainError("Không tìm thấy danh mục", 404);
        if (b.updatedAt !== current.updatedAt.toISOString())
          throw new DomainError("Danh mục đã thay đổi, tải lại", 409);
      }
      if (method === "DELETE") {
        const row = await table.update({
          where: { id: b.id },
          data: { isActive: false },
        });
        await tx.auditLog.create({
          data: {
            module: "CATALOG",
            action: "ARCHIVE",
            operator: actor.username,
            details: `Ngừng dùng ${kind} ${row.id}`,
          },
        });
        return row;
      }
      const name = text(b.name, "tên"),
        isActive = b.isActive ?? true;
      if (typeof isActive !== "boolean")
        throw new DomainError("Trạng thái không hợp lệ");
      const values: any = { name, isActive };
      if (["FACTORY", "TEAM", "RECRUITER"].includes(kind))
        values.code = text(b.code, "mã danh mục");
      if (
        kind === "FACTORY" &&
        current &&
        name !== current.name &&
        (await tx.recruitmentOrder.count({ where: { factoryId: current.id } }))
      )
        throw new DomainError(
          "Nhà máy đã có đơn hàng: không đổi tên để giữ lịch sử",
          409,
        );
      if (kind === "RECRUITER") {
        values.teamId = b.teamId || null;
        if (values.teamId) {
          const team = await tx.recruitmentTeam.findUnique({
            where: { id: values.teamId },
          });
          if (!team || !team.isActive)
            throw new DomainError("Team không tồn tại hoặc đã ngừng dùng");
        }
      }
      if (kind === "STATUS") {
        if (
          !["TRAINING", "NEW", "STOP"].includes(b.category) ||
          typeof b.warnsDuplicate !== "boolean" ||
          typeof b.endsAssignment !== "boolean"
        )
          throw new DomainError(
            "Nhóm trạng thái/cảnh báo/kết thúc không hợp lệ",
          );
        if (
          current &&
          current.name !== name &&
          (await tx.workAssignment.count({ where: { status: current.name } }))
        )
          throw new DomainError(
            "Trạng thái đã dùng: hãy tạo tên mới thay vì đổi lịch sử",
            409,
          );
        Object.assign(values, {
          category: b.category,
          warnsDuplicate: b.warnsDuplicate,
          endsAssignment: b.endsAssignment,
        });
      }
      if (kind === "IMPORT") {
        const mapping = b.mapping;
        const allowed = [
          "fullName",
          "idCard",
          "phone",
          "code",
          "dob",
          "gender",
          "idCardDate",
          "address",
          "province",
          "recruiter",
          "team",
          "source",
          "interviewFactory",
          "contractType",
          "status",
          "interviewDate",
          "passedDate",
          "interviewResult",
          "startDate",
          "employeeCode",
          "leaveDate",
          "leaveReason",
          "onboardingMonth",
          "orderId",
          "batchId",
        ];
        if (
          !mapping ||
          typeof mapping !== "object" ||
          Array.isArray(mapping) ||
          Object.entries(mapping).some(
            ([k, v]) =>
              !allowed.includes(k) ||
              typeof v !== "string" ||
              !v.trim() ||
              v.length > 100,
          )
        )
          throw new DomainError("Ánh xạ cột không hợp lệ");
        if (!mapping.fullName || !mapping.idCard)
          throw new DomainError("Ánh xạ cần họ tên và CCCD");
        if (
          b.sourceUrl &&
          !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/.test(
            b.sourceUrl,
          )
        )
          throw new DomainError(
            "Cần URL file Sheets cụ thể, không phải thư mục",
          );
        if (!["IMPORT_ONLY", "TWO_WAY"].includes(b.syncDirection))
          throw new DomainError("Chiều đồng bộ không hợp lệ");
        Object.assign(values, {
          mappingJson: JSON.stringify(mapping),
          sheetName: text(b.sheetName, "tên tab"),
          sourceUrl: b.sourceUrl || null,
          syncDirection: b.syncDirection,
        });
      }
      const row =
        method === "POST"
          ? await table.create({ data: values })
          : await table.update({ where: { id: b.id }, data: values });
      await tx.auditLog.create({
        data: {
          module: "CATALOG",
          action: method === "POST" ? "CREATE" : "UPDATE",
          operator: actor.username,
          details: `${kind} ${row.id}`,
        },
      });
      return row;
    });
    return NextResponse.json(
      { success: true, data },
      { status: method === "POST" ? 201 : 200 },
    );
  } catch (e) {
    return resultError(e);
  }
}
export const POST = (r: NextRequest) => save(r, "POST");
export const PUT = (r: NextRequest) => save(r, "PUT");
export const DELETE = (r: NextRequest) => save(r, "DELETE");
