import * as XLSX from "xlsx";
import { sourceMonth, sourceBonusAmounts, sourceRewardParts, sourceRewardText } from "@/lib/source-format";

const columns: Record<string, string[]> = {
  sequence: ["STT"],
  company: ["Công ty", "Nhà máy"],
  month: ["Tháng", "Kỳ tháng"],
  interviewDate: ["Ngày PV", "Ngày phỏng vấn"],
  policy: ["Chính sách"],
  workerCode: ["Mã nhân viên", "Mã NV"],
  fullName: ["Họ tên", "Họ và tên"],
  idCard: ["Số CCCD", "số CCCD", "CCCD", "CMT/CCCD"],
  accountNumber: ["STK", "Số tài khoản"],
  bankName: ["Ngân hàng", "Tên ngân hàng"],
  totalBonus: ["Tổng thưởng", "Tổng tiền thưởng"],
  ...Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [
      `bonus${index + 1}`,
      [`Thưởng lần ${index + 1}`],
    ]),
  ),
};

function normalizeHeader(value: string) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[+‐‑‒–—/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readBonusValue(
  row: Record<string, unknown>,
  field: string,
): unknown {
  const stage = /^bonus([1-7])$/.exec(field);
  if (stage) return sourceRewardParts(row, Number(stage[1])).value;
  const aliases = columns[field];
  if (!aliases) return undefined;
  const accepted = new Set(aliases.map(normalizeHeader));
  for (const [header, value] of Object.entries(row))
    if (accepted.has(normalizeHeader(header))) return value;
  return undefined;
}

function formatBonusDate(value: unknown): string {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) throw new Error("Ngày PV Excel không hợp lệ");
    return `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  return String(value ?? "").trim();
}

function formatBonusMonth(value: unknown, interviewDate: string): string {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) throw new Error("Kỳ tháng Excel không hợp lệ");
    return `T${String(parsed.m).padStart(2, "0")}.${parsed.y}`;
  }
  const source = String(value ?? "").trim();
  const compact = /^(?:T)?(0?[1-9]|1[0-2])[./-](\d{4})$/i.exec(source);
  if (compact) return `T${compact[1].padStart(2, "0")}.${compact[2]}`;
  return sourceMonth(source, interviewDate);
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

export function parseBonusImportRow(raw: Record<string, unknown>) {
  const interviewDate = formatBonusDate(readBonusValue(raw, "interviewDate"));
  const month = formatBonusMonth(readBonusValue(raw, "month"), interviewDate);
  if (!month) throw new Error("Thiếu tháng thưởng");

  const { bonuses, totalBonus, amountWarnings } = sourceBonusAmounts(raw);

  return {
    sequence: stringValue(readBonusValue(raw, "sequence")),
    company: stringValue(readBonusValue(raw, "company")),
    month,
    monthOriginal: readBonusValue(raw, "month"),
    interviewDate,
    policy: stringValue(readBonusValue(raw, "policy")),
    workerCode: stringValue(readBonusValue(raw, "workerCode")),
    fullName: stringValue(readBonusValue(raw, "fullName")),
    idCard: stringValue(readBonusValue(raw, "idCard")),
    accountNumber: stringValue(readBonusValue(raw, "accountNumber")),
    bankName: stringValue(readBonusValue(raw, "bankName")),
    bonuses,
    rewardDetails: Array.from({ length: 7 }, (_, i) => sourceRewardParts(raw, i + 1)),
    rewardTexts: Array.from({ length: 7 }, (_, i) => sourceRewardText(raw, i + 1)),
    totalBonus,
    amountWarnings,
  };
}
