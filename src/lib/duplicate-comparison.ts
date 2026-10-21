import { dateKey, normalizeCccd, phoneKey } from "@/lib/worker-validation";
import { sameFactory } from "@/lib/duplicate-check";
import { sourceMonth } from "@/lib/source-format";

export const comparisonFields = [
  ["Họ và tên", "fullName"], ["Số CCCD", "idCard"], ["Số điện thoại", "phone"],
  ["Giới tính", "gender"], ["Ngày sinh", "dob"], ["Tỉnh/Thành", "province"],
  ["Địa chỉ/Quê quán", "address"], ["Mã nhân viên", "employeeCode"],
  ["Công ty / Nhà máy", "factory"], ["Ngày phỏng vấn", "interviewDate"],
  ["Trạng thái làm việc", "status"], ["Ngày nghỉ việc", "leaveDate"],
  ["Người tuyển dụng", "recruiter"], ["Tháng thưởng", "month"],
  ["Tổng thưởng", "totalBonus"], ["Chi tiết thưởng L1–L7", "bonusDetails"],
  ["Ngân hàng / STK", "bankInfo"],
] as const;
const text = (value: unknown) => String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
export const isEmptyComparison = (value: unknown) => ["", "—", "— • —", "chưa có ngày nghỉ"].includes(text(value));
export function displayReviewMonth(value: unknown, interviewDate = "") {
  const raw = String(value ?? "").trim();
  if (isEmptyComparison(raw)) return "—";
  try {
    const compact = /^(?:T)?(0?[1-9]|1[0-2])[./-](\d{4})$/i.exec(raw);
    const canonical = compact ? "T" + compact[1].padStart(2, "0") + "." + compact[2] : sourceMonth(raw, interviewDate);
    const match = /^T(\d{2})\.(\d{4})$/.exec(canonical);
    return match ? "Tháng " + match[1] + "/" + match[2] : raw;
  } catch { return raw; }
}
function amount(value: unknown) {
  const s = text(value);
  // Normalize numeric money only; preserve source notes such as "Không đạt thưởng".
  return /^\d[\d., ]*(?:\s*(?:đ|₫|vnd))?$/.test(s)
    ? String(Number(s.replace(/[., đ₫]|vnd/g, ""))) : s;
}
function normalized(label: string, value: unknown, side: any) {
  if (isEmptyComparison(value)) return "";
  if (label === "Tháng thưởng" || label === "Tháng nhận việc") return displayReviewMonth(value, side?.interviewDate);
  if (["Ngày sinh", "Ngày phỏng vấn", "Ngày nghỉ việc", "Ngày bắt đầu làm", "Ngày cấp", "Ngày đỗ", "Ngày đào tạo dự kiến", "Ngày đào tạo chuẩn"].includes(label)) return dateKey(String(value)) || text(value);
  if (label === "Số CCCD") return normalizeCccd(value);
  if (label === "Số điện thoại") return phoneKey(String(value)) || text(value);
  if (label === "Tổng thưởng") return amount(value);
  if (label === "Chi tiết thưởng L1–L7") return String(value).split("|").map(part => {
    const match = /^\s*L(\d):\s*(.*)$/i.exec(part);
    return match ? "L" + match[1] + ":" + amount(match[2]) : text(part);
  }).sort().join("|");
  return text(value);
}
export function comparisonState(label: string, left: unknown, right: unknown, leftSide: any = {}, rightSide: any = {}) {
  const before = normalized(label, left, leftSide), after = normalized(label, right, rightSide);
  const added = !before && !!after;
  const equal = label === "Công ty / Nhà máy" && before && after ? sameFactory(String(left), String(right)) : before === after;
  return { added, conflict: !!before && !!after && !equal };
}
export function compareDuplicateSides(left: any, right: any, extraRows: Array<{label: string; leftVal: unknown; rightVal: unknown}> = []) {
  const rows = [...comparisonFields.map(([label, key]) => ({ label, leftVal: left[key], rightVal: right[key] })), ...extraRows];
  return rows.reduce((result, row) => {
    const state = comparisonState(row.label, row.leftVal, row.rightVal, left, right);
    if (state.added) result.additions.push(row.label);
    if (state.conflict) result.conflicts.push(row.label + " khác thông tin đang có");
    return result;
  }, { additions: [] as string[], conflicts: [] as string[] });
}
