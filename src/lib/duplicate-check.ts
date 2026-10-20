import { dateKey, phoneKey, formatExcelDate } from "@/lib/worker-validation";
export const identityText = (v: unknown) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
export const sameFactory = (a: unknown, b: unknown) => !!identityText(a) && identityText(a) === identityText(b);
export const sameInterviewDay = (a: any, b: any) => !!dateKey(a?.interviewDate || "") && dateKey(a.interviewDate) === dateKey(b?.interviewDate || "");
export function assertIdentity(worker: any, fullName: string) {
    if (worker?.fullName && fullName && identityText(worker.fullName) !== identityText(fullName))
        throw new Error("Sai lệch danh tính: cùng CCCD nhưng khác họ tên; cần xác minh trước khi tiếp tục");
}
export function isActiveAssignment(a: any, statuses: any[] = []) {
    const key = identityText(a.status);
    const configured = statuses.find(s => identityText(s.name) === key);
    const ended = configured?.endsAssignment === true || /^bỏ/.test(key) || /nghỉ|hết phí|bỏ xx|bỏ xưởng|bỏ việc|bỏ vì sức khỏe|không theo dõi|ko theo dõi|hết hợp đồng|hết hạn|kết thúc/.test(key) || ["nh", "hhđ"].includes(key);
    // Contradictory leave fields do not silently suppress an active-status warning.
    if (ended)
        return false;
    if (configured?.warnsDuplicate === true || /đang làm|đang lv|^lv$|chuyển chính thức|đào tạo/.test(key))
        return true;
    if (/chờ phỏng vấn|đạt phỏng vấn|trượt|^bỏ/.test(key))
        return false;
    if (configured)
        return configured.warnsDuplicate === true;
    return !a.leaveDate && !a.leaveReason;
}
export function resolveBonusAssignment(worker: any, row: any) {
    assertIdentity(worker, row.fullName);
    if (!dateKey(row.interviewDate || ""))
        throw new Error("Thiếu hoặc sai ngày PV; chưa đủ căn cứ liên kết thưởng");
    const matches = (worker?.assignments || []).filter((a: any) => sameInterviewDay(a, row));
    if (matches.length > 1)
        throw new Error("Trùng lặp nội bộ: nhiều lượt PV cùng ngày; cần đối chiếu");
    if (!matches.length)
        return null;
    const a = matches[0];
    if (!sameFactory(a.interviewFactory, row.company) && !sameFactory(a.workingFactory, row.company))
        throw new Error("Trùng lặp nội bộ: CCCD và ngày PV khớp nhưng khác công ty");
    if (row.workerCode && a.employeeCode && identityText(row.workerCode) !== identityText(a.employeeCode))
        throw new Error("Trùng lặp nội bộ: mã nhân viên không khớp lượt PV");
    return a;
}
export function assertDailyInterview(worker: any, row: any, excludeId?: string) {
    if (!dateKey(row?.interviewDate || ""))
        throw new Error("Trùng lặp nội bộ: thiếu hoặc sai ngày PV; chưa đủ căn cứ kiểm tra lượt tuyển");
    if ((worker?.assignments || []).some((a: any) => a.id !== excludeId && sameInterviewDay(a, row)))
        throw new Error("Trùng lặp nội bộ: CCCD đã có lượt PV trong ngày này; mỗi ngày chỉ được phỏng vấn một lần");
}
export { phoneKey };
export function assertSourceCard(raw: any, normalized: string) {
    const value = raw["số CCCD"] ?? raw["Số CCCD"] ?? raw["CCCD"] ?? raw["CMT/CCCD"];
    if (value != null && String(value).replace(/\s+/g, "") !== normalized)
        throw new Error("Sai lệch danh tính: CCCD thiếu chữ số; cần đối chiếu bản gốc");
}
export async function assertReviewProfile(tx: any, person: any, worker: any, assignment: any, excludeId?: string) {
    assertIdentity(person, worker.fullName);
    assertDailyInterview(person, assignment, excludeId);
    const statuses = await tx.laborStatus.findMany({ where: { isActive: true } });
    if ((person?.assignments || []).some((a: any) => a.id !== excludeId && isActiveAssignment(a, statuses) && !sameFactory(a.workingFactory || a.interviewFactory, assignment.workingFactory || assignment.interviewFactory)))
        throw new Error("CHƯA BÁO NGHỈ: cần xử lý chuyển công ty ở cảnh báo trùng, không duyệt bổ sung trực tiếp");
}

// A same-day row may fill blanks only when its existing facts agree.
export function sourceConflicts(person: any, raw: any): string[] {
 if (!person) return [];
 const issues: string[] = [];
 const name = raw["Họ và tên"] || raw["Họ tên"];
 if (name && person.fullName && identityText(name) !== identityText(person.fullName)) issues.push("Họ tên không khớp CCCD");
 const day = formatExcelDate(raw["Ngày PV"] || raw["Ngày phỏng vấn"] || "");
 const matches = (person.assignments || []).filter((a: any) => sameInterviewDay(a, {interviewDate: day}));
 if (matches.length > 1) issues.push("Có nhiều lượt tuyển cùng ngày trong hệ thống");
 const company = raw["Công ty"] || raw["Nhà máy PV"] || raw["Nhà máy làm việc"];
 for (const a of matches) {
  if (company && !sameFactory(a.interviewFactory, company) && !sameFactory(a.workingFactory, company)) issues.push("Cùng ngày PV nhưng khác công ty");
  const pairs = [
   ["Mã nhân viên", a.employeeCode, raw["Mã NV"] || raw["Mã nhân viên"]],
   ["Trạng thái", a.status, raw["Tình trạng"]],
   ["Người tuyển dụng", a.recruiter, raw["Tuyển dụng"] || raw["Người tuyển"]],
  ];
  for (const [label, old, next] of pairs) if (old && next && identityText(old) !== identityText(next)) issues.push(label + " không khớp lượt tuyển");
  const leave = formatExcelDate(raw["Ngày NH"] || raw["Ngày nghỉ"] || "");
  if (a.leaveDate && leave && dateKey(a.leaveDate) !== dateKey(leave)) issues.push("Ngày nghỉ việc không khớp lượt tuyển");
 }
 return [...new Set(issues)];
}
export function assertSourceCompatible(person: any, raw: any) {
 const conflicts = sourceConflicts(person, raw);
 if (conflicts.length) throw new Error("Xung đột lượt tuyển: " + conflicts.join("; ") + ". Giữ nguyên dữ liệu để xác minh.");
}
export function fillMissing(current: any, incoming: Record<string, any>) {
 return Object.fromEntries(Object.entries(incoming).filter(([key, value]) => value !== undefined && value !== null && String(value).trim() !== "" && (current?.[key] === undefined || current?.[key] === null || String(current[key]).trim() === "")));
}
