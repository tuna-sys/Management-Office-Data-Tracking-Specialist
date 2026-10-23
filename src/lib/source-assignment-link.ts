import { createHash } from "node:crypto";
import { dateKey, normalizeCccd } from "@/lib/worker-validation";
import { identityText, sameFactory } from "@/lib/duplicate-check";
import { splitImportReview } from "@/lib/import-review";
import { parseBonusImportRow } from "@/lib/bonus-import";

export function matchSourceAssignment(worker: any, raw: any) {
  const result = (state: string, reason: string, assignmentId: string | null = null) => ({ state, reason, assignmentId });
  const card = normalizeCccd(raw["Số CCCD"] || raw["số CCCD"] || raw.CCCD || "");
  if (!worker || !card || normalizeCccd(worker.idCard) !== card) return result("NO_WORKER", "Chưa có hồ sơ đúng CCCD; không dùng SĐT để tự liên kết");
  const name = raw["Họ và tên"] || raw["Họ tên"];
  if (name && worker.fullName && identityText(name) !== identityText(worker.fullName)) return result("IDENTITY_CONFLICT", "CCCD khớp nhưng họ tên khác; cần đối chiếu bản gốc");
  const day = dateKey(raw["Ngày PV"] || raw["Ngày phỏng vấn"] || "");
  if (!day) return result("MISSING_DATE", "Thiếu hoặc sai ngày PV; chưa đủ căn cứ liên kết");
  const company = raw["Công ty"] || raw["Nhà máy PV"];
  if (!identityText(company)) return result("MISSING_COMPANY", "Thiếu công ty phỏng vấn; chưa đủ căn cứ liên kết");
  const matches = (worker.assignments || []).filter((a: any) => dateKey(a.interviewDate || "") === day);
  if (matches.length > 1) return result("AMBIGUOUS", "Có nhiều lượt tuyển cùng ngày; cần đối chiếu trước khi chọn");
  if (!matches.length) return result("NO_ASSIGNMENT", "Chưa có lượt tuyển đúng ngày PV. Nhập DS_TONG hoặc bổ sung lượt tuyển đã xác minh");
  const assignment = matches[0];
  if (!sameFactory(assignment.interviewFactory, company)) return result("COMPANY_CONFLICT", "Ngày PV khớp nhưng khác công ty; không tự chuyển liên kết");
  const code = raw["Mã nhân viên"] || raw["Mã NV"];
  if (code && assignment.employeeCode && identityText(code) !== identityText(assignment.employeeCode)) return result("CODE_CONFLICT", "Mã nhân viên không khớp lượt tuyển");
  return result("MATCHED", "Khớp CCCD, danh tính, ngày PV, công ty và mã nhân viên đã có", assignment.id);
}
export function sourceLinkDecision(worker: any, source: any, row: any) {
  const blocked = splitImportReview([...(row.warnings || []), ...(row.duplicates || [])]).duplicates.length > 0;
  const matched = blocked ? { state: "SOURCE_CONFLICT", reason: "Dòng nguồn đang có xung đột; cần xử lý trước khi liên kết", assignmentId: null } : matchSourceAssignment(worker, row.values || {});
  const assignment = (worker?.assignments || []).find((a: any) => a.id === matched.assignmentId);
  const linkToken = matched.state === "MATCHED" ? createHash("sha256").update(JSON.stringify({ sourceId: source.id, type: source.type,
    row: row.row, values: row.values, worker: [worker.id, worker.updatedAt], assignment })).digest("hex") : null;
  return { ...matched, linkToken };
}
export class SourceLinkError extends Error { constructor(message: string, public status = 409) { super(message); } }
export async function linkSourceBonus(tx: any, source: any, row: any, input: any, operator: string) {
  if (source.type !== "DS_THUONG") throw new SourceLinkError("Chỉ liên kết bản thưởng từ DS_THUONG; không tạo lượt tuyển từ nguồn thưởng", 400);
  const parsed = parseBonusImportRow(row.values || {});
  const worker = await tx.worker.findUnique({ where: { idCard: parsed.idCard }, include: { assignments: true } });
  const decision = sourceLinkDecision(worker, source, row);
  if (decision.state !== "MATCHED") throw new SourceLinkError(decision.reason);
  if (input.assignmentId !== decision.assignmentId || input.linkToken !== decision.linkToken) throw new SourceLinkError("Dữ liệu đối chiếu đã thay đổi; tải lại trước khi liên kết");
  const records = await tx.bonusRecord.findMany({ where: { workerId: worker.id, month: parsed.month } });
  const matches = records.filter((b: any) => {
    let note: any; try { note = JSON.parse(b.note || "{}"); } catch { return false; }
    return note.source === "SOURCE_EXCEL_ACTUAL_PAID" && sameFactory(b.company, parsed.company)
      && dateKey(b.interviewDate || "") === dateKey(parsed.interviewDate)
      && (!b.workerCode || !parsed.workerCode || identityText(b.workerCode) === identityText(parsed.workerCode))
      && Number(b.totalBonus || 0) === parsed.totalBonus
      && parsed.bonuses.every((amount: number, i: number) => Number(b["bonus" + (i + 1)] || 0) === amount);
  });
  if (matches.length !== 1) throw new SourceLinkError(matches.length ? "Có nhiều bản thưởng phù hợp; cần đối chiếu" : "Chưa có bản thưởng chuẩn khớp số tiền và nguồn; không tự tạo bản mới");
  const bonus = matches[0];
  if (bonus.assignmentId === decision.assignmentId) return { linked: false, bonusId: bonus.id, assignmentId: decision.assignmentId };
  if (bonus.assignmentId) throw new SourceLinkError("Bản thưởng đã gắn với lượt tuyển khác; không tự đổi liên kết");
  if (bonus.status !== "DRAFT") throw new SourceLinkError("Bản thưởng đã duyệt/khóa; cần quy trình điều chỉnh riêng");
  const changed = await tx.bonusRecord.updateMany({ where: { id: bonus.id, assignmentId: null, status: "DRAFT", updatedAt: bonus.updatedAt }, data: { assignmentId: decision.assignmentId } });
  if (changed.count !== 1) throw new SourceLinkError("Bản thưởng vừa thay đổi; tải lại để đối chiếu");
  await tx.auditLog.create({ data: { module: "IMPORT_RECONCILIATION", action: "LINK_SOURCE_BONUS", operator,
    details: JSON.stringify({ sourceId: source.id, row: row.row, bonusId: bonus.id, workerId: worker.id, beforeAssignmentId: null, afterAssignmentId: decision.assignmentId }) } });
  return { linked: true, bonusId: bonus.id, assignmentId: decision.assignmentId };
}
