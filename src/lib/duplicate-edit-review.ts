import { createHash } from "node:crypto";
import { dateKey, normalizeCccd, phoneKey, validateWorker } from "@/lib/worker-validation";
import { assertDailyInterview, sameFactory, sameInterviewDay } from "@/lib/duplicate-check";
import { parseBonusImportRow, readBonusValue } from "@/lib/bonus-import";
import { sourceMonth } from "@/lib/source-format";
import { inferProvince } from "@/lib/worker-import";

export type EditableReviewField = { key: string; label: string; before: string; source: string; kind?: "date" | "month" };
const value = (v: unknown) => String(v ?? "");
function bonusFor(worker: any, assignment: any, raw: any) {
  try {
    const parsed = parseBonusImportRow(raw);
    return (worker.bonusRecords || []).find((b: any) => b.assignmentId === assignment.id && b.month === parsed.month && sameFactory(b.company || "", parsed.company)) || null;
  } catch { return null; }
}
function bankFor(worker: any, raw: any) {
  const account = value(readBonusValue(raw, "accountNumber")).trim();
  return (worker.bankAccounts || []).find((b: any) => b.accountNumber === account) || worker.bankAccounts?.[0] || null;
}
export function editableReviewFields(worker: any, assignment: any, raw: any, type: string): EditableReviewField[] {
  const fields: EditableReviewField[] = [];
  const add = (key: string, label: string, before: any, incoming: any, kind?: "date" | "month") => fields.push({ key, label, before: value(before), source: value(incoming), kind });
  const address = raw["Địa chỉ"] || raw["Quê quán"];
  const profile = [
    ["fullName", "Họ và tên", raw["Họ và tên"] || raw["Họ tên"]], ["phone", "Số điện thoại", raw["SĐT"] || raw["Số điện thoại"]],
    ["gender", "Giới tính", raw["Giới tính"]], ["dob", "Ngày sinh", raw["Ngày sinh"]],
    ["address", "Địa chỉ/Quê quán", address], ["province", "Tỉnh/Thành", raw["Tỉnh/Thành"] || raw["Tỉnh"] || inferProvince(address || "")],
    ["idCardDate", "Ngày cấp", raw["Ngày cấp"]], ["idCardPlace", "Nơi cấp", raw["Nơi cấp"]], ["source", "Nguồn", raw["Nguồn"]],
  ];
  for (const [key, label, incoming] of profile) add("worker." + key, label, worker[key], incoming, ["dob", "idCardDate"].includes(key) ? "date" : undefined);
  const assignmentFields = [
    ["interviewFactory", "Công ty / Nhà máy", raw["Nhà máy PV"] || raw["Công ty"]],
    ["employeeCode", "Mã nhân viên", raw["Mã NV"] || raw["Mã nhân viên"]],
    ["interviewDate", "Ngày phỏng vấn", raw["Ngày PV"] || raw["Ngày phỏng vấn"]],
    ["status", "Trạng thái làm việc", raw["Tình trạng"] || raw["TT"]],
    ["leaveDate", "Ngày nghỉ việc", raw["Ngày NH"] || raw["Ngày nghỉ"]], ["leaveReason", "Lý do nghỉ", raw["Lý do"]],
    ["recruiter", "Người tuyển dụng", raw["Tuyển dụng"] || raw["Người tuyển"]],
    ["startDate", "Ngày bắt đầu làm", raw["Ngày bắt đầu làm"] || raw["Ngày vào làm"]],
    ["contractType", "Loại hợp đồng", raw["Loại HĐ"] || raw["Loại HD"]], ["team", "Đội nhóm", raw["Team"] || raw["Đội nhóm"]],
    ["shuttleBusKtx", "Đón xe / KTX", raw["Đón xe + KTX"] || raw["Đón xe - KTX"]],
    ["passedDate", "Ngày đỗ", raw["Ngày đỗ"] || raw["Ngày PV đỗ"]], ["interviewResult", "Kết quả phỏng vấn", raw["Kết quả PV"]],
    ["expectedTrainingDate", "Ngày đào tạo dự kiến", raw["Ngày Đào tạo dự kiến"]],
    ["expectedTrainingStatus", "Tình trạng đào tạo", raw["Tình trạng đào tạo"] || raw["Tình trạng Đào tạo dự kiến"]],
    ["standardTrainingDate", "Ngày đào tạo chuẩn", raw["Ngày đào tạo chuẩn"]],
    ["onboardingMonth", "Tháng nhận việc", type === "DS_TONG" ? raw["Tháng nhận việc"] || raw["Tháng"] : ""],
  ];
  for (const [key, label, incoming] of assignmentFields) add("assignment." + key, label, assignment[key], incoming,
    key.endsWith("Date") ? "date" : key === "onboardingMonth" ? "month" : undefined);
  if (type === "DS_THUONG") {
    const bonus = bonusFor(worker, assignment, raw);
    add("bonus.month", "Tháng thưởng", bonus?.month, readBonusValue(raw, "month"), "month");
    add("bonus.policy", "Chính sách thưởng", bonus?.policy, readBonusValue(raw, "policy"));
    let rewards: any[] = [];
    try { const saved = JSON.parse(bonus?.note || "{}").rewards; if (Array.isArray(saved)) rewards = saved; } catch { /* Legacy note. */ }
    for (let n = 1; n <= 7; n++) add("bonus.bonus" + n, "Thưởng lần " + n, bonus?.["bonus" + n] || rewards[n - 1] || "", readBonusValue(raw, "bonus" + n));
    add("bonus.totalBonus", "Tổng thưởng", bonus?.totalBonus, readBonusValue(raw, "totalBonus"));
    const bank = bankFor(worker, raw);
    add("bank.accountNumber", "Số tài khoản", bank?.accountNumber, readBonusValue(raw, "accountNumber"));
    add("bank.bankName", "Ngân hàng", bank?.bankName, readBonusValue(raw, "bankName"));
  }
  return fields;
}
export function editReviewToken(worker: any, assignment: any, raw: any, type: string) {
  const revisions = (items: any[]) => (items || []).map(x => [x.id, x.updatedAt, x.status]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify({ worker: [worker.id, worker.updatedAt], assignment: [assignment.id, assignment.updatedAt],
    assignments: revisions(worker.assignments), bonuses: revisions(worker.bonusRecords), banks: revisions(worker.bankAccounts),
    fields: editableReviewFields(worker, assignment, raw, type), raw, type })).digest("hex");
}

export async function resolveEditedReview(tx: any, source: any, row: any, body: any, actor: string) {
  const previewOnly = body.resolution === "PREVIEW_EDIT";
  const note = previewOnly ? "Xem trước" : typeof body.reviewerNote === "string" ? body.reviewerNote.trim() : "";
  if (body.confirmResolution !== true || !note || note.length > 1000) throw new Error("Cần xem trước, xác nhận và ghi lý do duyệt (tối đa 1000 ký tự)");
  if (!["DS_TONG", "DS_THUONG"].includes(source.type)) throw new Error("Loại nguồn chưa hỗ trợ chỉnh sửa và duyệt");
  const raw = row.values || {};
  const card = normalizeCccd(raw["Số CCCD"] || raw["số CCCD"] || raw.CCCD || raw["CMT/CCCD"] || "");
  const worker = await tx.worker.findUnique({ where: { idCard: card }, include: { assignments: true, bonusRecords: { orderBy: { createdAt: "desc" } }, bankAccounts: { orderBy: { createdAt: "desc" } } } });
  const assignment = worker?.assignments?.find((a: any) => a.id === body.targetAssignmentId);
  if (!worker || !assignment) throw new Error("Không tìm thấy đúng hồ sơ và lượt tuyển; tải lại danh sách");
  if (!sameInterviewDay(assignment, { interviewDate: raw["Ngày PV"] || raw["Ngày phỏng vấn"] })) throw new Error("Lượt tuyển không khớp ngày phỏng vấn của dòng nguồn");
  if (body.editReviewToken !== editReviewToken(worker, assignment, raw, source.type)) throw new Error("Dữ liệu đã thay đổi; tải lại trước khi chỉnh sửa và duyệt");
  const sourceKey = "review-source:" + source.id + ":" + row.row + ":" + body.editReviewToken;
  if (await tx.auditLog.findFirst({ where: { module: "DUPLICATE_REVIEW", action: "REVIEW_SOURCE", details: { contains: sourceKey } } })) throw new Error("Dòng đã được xử lý; tải lại danh sách");
  const fields = editableReviewFields(worker, assignment, raw, source.type);
  if (!Array.isArray(body.fieldDecisions) || body.fieldDecisions.length !== fields.length) throw new Error("Cần quyết định cho từng trường");
  const decisions = new Map<string, any>();
  for (const d of body.fieldDecisions) {
    if (!d || typeof d.key !== "string" || decisions.has(d.key) || !fields.some(f => f.key === d.key) || !["KEEP", "SOURCE", "CUSTOM"].includes(d.mode)) throw new Error("Quyết định hoặc trường chỉnh sửa không hợp lệ");
    if (d.mode === "CUSTOM" && (typeof d.value !== "string" || d.value.length > 2000)) throw new Error("Giá trị chỉnh sửa không hợp lệ hoặc quá dài");
    decisions.set(d.key, d);
  }
  const final: Record<string, string> = {}, changes: Array<{key: string; label: string; before: string; after: string}> = [];
  const finalDate = fields.find(f => f.key === "assignment.interviewDate")!;
  const dateDecision = decisions.get(finalDate.key);
  const interviewDay = dateDecision.mode === "KEEP" ? finalDate.before : dateDecision.mode === "SOURCE" ? finalDate.source : dateDecision.value.trim();
  for (const f of fields) {
    const d = decisions.get(f.key);
    let next = d.mode === "KEEP" ? f.before : d.mode === "SOURCE" ? f.source : d.value.trim();
    if (d.mode !== "KEEP") {
      if (f.kind === "date" && next) { const day = dateKey(next); if (!day) throw new Error(f.label + " không hợp lệ"); next = day; }
      if (f.kind === "month" && next) {
        const compact = /^(?:T)?(0?[1-9]|1[0-2])[./-](\d{4})$/i.exec(next);
        next = compact ? "T" + compact[1].padStart(2, "0") + "." + compact[2] : sourceMonth(next, interviewDay);
      }
      if (f.key === "worker.phone" && next) { next = phoneKey(next); if (!/^0\d{9,10}$/.test(next)) throw new Error("Số điện thoại không hợp lệ"); }
      if (next.length > 2000) throw new Error(f.label + " quá dài");
    }
    final[f.key] = next;
    if (next !== f.before) changes.push({ key: f.key, label: f.label, before: f.before, after: next });
  }
  const workerPatch: any = {}, assignmentPatch: any = {};
  for (const c of changes) {
    if (c.key.startsWith("worker.")) workerPatch[c.key.slice(7)] = c.after;
    if (c.key.startsWith("assignment.")) assignmentPatch[c.key.slice(11)] = c.after;
  }
  const mergedWorker = { ...worker, ...workerPatch }, merged = { ...assignment, ...assignmentPatch };
  if (!dateKey(merged.interviewDate)) throw new Error("Ngày phỏng vấn không hợp lệ");
  assertDailyInterview(worker, merged, assignment.id);
  if (merged.leaveDate && (!dateKey(merged.leaveDate) || dateKey(merged.leaveDate)! < dateKey(merged.interviewDate)!)) throw new Error("Ngày nghỉ không hợp lệ hoặc trước ngày phỏng vấn");
  validateWorker(mergedWorker, merged, true, true);
  const protectedChange = ["interviewFactory", "interviewDate", "employeeCode"].some(k => k in assignmentPatch);
  if (protectedChange && await tx.policyEnrollment.count({ where: { assignmentId: assignment.id } })) throw new Error("Đợt đã áp dụng chính sách; cần xử lý điều chỉnh thưởng trước khi đổi liên kết");
  if (["interviewFactory", "interviewDate"].some(k => k in assignmentPatch) && worker.bonusRecords.some((b: any) => b.assignmentId === assignment.id)) throw new Error("Lượt tuyển đã có bản thưởng; không đổi công ty/ngày PV tại màn hình này");
  const before: any = { worker: JSON.parse(JSON.stringify(worker)), assignment: { ...assignment } };
  let after: any = { worker: { ...worker, ...workerPatch }, assignment: merged };
  const bonusChanges = changes.filter(c => c.key.startsWith("bonus."));
  let rewardData: any = null, currentBonus: any = null;
  if (bonusChanges.length) {
    currentBonus = bonusFor(worker, assignment, raw);
    if (currentBonus && currentBonus.status !== "DRAFT") throw new Error("Bản thưởng đã duyệt/khóa; không thể sửa");
    const rewardRaw: any = { "Số CCCD": worker.idCard, "Họ tên": mergedWorker.fullName, "Công ty": merged.interviewFactory, "Ngày PV": merged.interviewDate, "Tháng": final["bonus.month"], "Chính sách": final["bonus.policy"], "Mã nhân viên": merged.employeeCode };
    for (let n = 1; n <= 7; n++) rewardRaw["Thưởng lần " + n] = final["bonus.bonus" + n];
    if (decisions.get("bonus.totalBonus")?.mode !== "KEEP" || !bonusChanges.some(c => /^bonus.bonus[1-7]$/.test(c.key))) rewardRaw["Tổng thưởng"] = final["bonus.totalBonus"];
    const parsed = parseBonusImportRow(rewardRaw);
    if (parsed.amountWarnings.length) throw new Error(parsed.amountWarnings.join("; "));
    const collision = worker.bonusRecords.find((b: any) => b.id !== currentBonus?.id && b.assignmentId === assignment.id && b.month === parsed.month && sameFactory(b.company || "", parsed.company));
    if (collision) throw new Error("Đã có bản thưởng khác cho tháng này; cần đối chiếu riêng");
    rewardData = { workerId: worker.id, assignmentId: assignment.id, company: parsed.company, month: parsed.month, interviewDate: merged.interviewDate, workerCode: merged.employeeCode, policy: parsed.policy,
      ...Object.fromEntries(parsed.bonuses.map((amount: number, i: number) => ["bonus" + (i + 1), amount])), totalBonus: parsed.totalBonus,
      note: JSON.stringify({ source: "REVIEWER_EDITED", sourceValues: raw, reviewedValues: rewardRaw, rewards: Array.from({ length: 7 }, (_, i) => final["bonus.bonus" + (i + 1)]) }) };
    before.bonus = currentBonus;
  }
  const bankChanges = changes.some(c => c.key.startsWith("bank."));
  if (bankChanges && (!final["bank.accountNumber"] || !final["bank.bankName"])) throw new Error("Cần nhập cả ngân hàng và số tài khoản");
  if (rewardData && value(rewardData.totalBonus) !== final["bonus.totalBonus"]) {
    final["bonus.totalBonus"] = value(rewardData.totalBonus);
    const total = fields.find(f => f.key === "bonus.totalBonus")!;
    const recorded = changes.find(c => c.key === total.key);
    if (recorded) recorded.after = final[total.key];
    else if (final[total.key] !== total.before) changes.push({ key: total.key, label: total.label, before: total.before, after: final[total.key] });
  }
  if (previewOnly) return { removeSource: false, correctedInterviewDate: null, message: "Đã kiểm tra bản xem trước; chưa lưu dữ liệu", previewFields: fields.map(f => ({ ...f, after: final[f.key] })), changeCount: changes.length };
  // All validation completes before any write; the caller runs this inside one transaction.
  if (Object.keys(workerPatch).length) await tx.worker.update({ where: { id: worker.id }, data: workerPatch });
  if (Object.keys(assignmentPatch).length) await tx.workAssignment.update({ where: { id: assignment.id }, data: assignmentPatch });
  if (rewardData) after.bonus = currentBonus ? await tx.bonusRecord.update({ where: { id: currentBonus.id }, data: rewardData }) : await tx.bonusRecord.create({ data: { ...rewardData, status: "DRAFT" } });
  if (bankChanges) {
    before.bank = bankFor(worker, raw);
    const sameAccount = worker.bankAccounts.find((b: any) => b.accountNumber === final["bank.accountNumber"]);
    const bankData = { bankName: final["bank.bankName"], accountNumber: final["bank.accountNumber"], accountHolderName: mergedWorker.fullName, isNameVerified: false, verificationStatus: "UNVERIFIED" };
    after.bank = sameAccount ? await tx.bankAccount.update({ where: { id: sameAccount.id }, data: bankData }) : await tx.bankAccount.create({ data: { ...bankData, workerId: worker.id } });
  }
  const history = { sourceKey, decision: "EDIT_AND_APPROVE", reviewer: actor, reason: note, source: { id: source.id, file: source.file, sheet: source.sheet, type: source.type, row: row.row, values: raw }, before, after, changes, fieldDecisions: body.fieldDecisions };
  await tx.auditLog.create({ data: { module: "DUPLICATE_REVIEW", action: "REVIEW_SOURCE", operator: actor, details: JSON.stringify(history) } });
  await tx.assignmentEvent.create({ data: { assignmentId: assignment.id, occurredOn: new Date().toISOString().slice(0, 10), fromStatus: assignment.status, toStatus: merged.status, operator: actor,
    note: "Chỉnh sửa & duyệt: " + (changes.map(c => c.label + ": " + (c.before || "trống") + " → " + (c.after || "trống")).join("; ") || "Giữ nguyên thông tin hiện có") + ". Lý do: " + note } });
  return { removeSource: true, correctedInterviewDate: null, message: "Đã lưu quyết định từng trường và lịch sử trước/sau" };
}
