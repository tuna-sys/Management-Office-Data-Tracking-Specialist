import * as XLSX from "xlsx";
import { sourceMonth, sourceRewardAmount } from "@/lib/source-format";

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

function parseBonusAmount(value: unknown, label: string) {
  const source = stringValue(value);
  if (!source || /^[-–—]$/.test(source)) return { amount: 0 };

  let amount: number;
  try {
    amount = sourceRewardAmount(value);
  } catch (error: any) {
    if (error?.message === "Tiền thưởng không hợp lệ") throw error;
    const match = /([0-9]+(?:[.,][0-9]+)?)\s*(triệu|tr|million|m|nghìn|ngàn|k)(?=\s|$|[^\p{L}])/iu.exec(source);
    if (!match)
      return {
        amount: 0,
        warning: `${label}: giữ nguyên nội dung nguồn; không suy ra được số tiền từ “${source}”.`,
      };
    const numericValue = Number(match[1].replace(",", "."));
    const multiplier = /^(triệu|tr|million|m)$/i.test(match[2])
      ? 1_000_000
      : 1_000;
    amount = Math.round(numericValue * multiplier);
  }

  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error(`${label}: số tiền vượt giới hạn an toàn`);
  return { amount };
}

export function parseBonusImportRow(raw: Record<string, unknown>) {
  const interviewDate = formatBonusDate(readBonusValue(raw, "interviewDate"));
  const month = formatBonusMonth(readBonusValue(raw, "month"), interviewDate);
  if (!month) throw new Error("Thiếu tháng thưởng");

  const bonusResults = Array.from({ length: 7 }, (_, index) =>
    parseBonusAmount(
      readBonusValue(raw, `bonus${index + 1}`),
      `Thưởng lần ${index + 1}`,
    ),
  );
  const bonuses = bonusResults.map((result) => result.amount);
  const amountWarnings = bonusResults.flatMap((result) =>
    result.warning ? [result.warning] : [],
  );
  const totalCell = readBonusValue(raw, "totalBonus");
  let totalBonus = bonuses.reduce((sum, amount) => sum + amount, 0);
  if (totalCell !== undefined && totalCell !== null && totalCell !== "") {
    const totalResult = parseBonusAmount(totalCell, "Tổng thưởng");
    if (totalResult.warning) amountWarnings.push(totalResult.warning);
    else totalBonus = totalResult.amount;
  }
  if (!Number.isSafeInteger(totalBonus) || totalBonus < 0)
    throw new Error("Tổng thưởng vượt giới hạn số nguyên an toàn");

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
    totalBonus,
    amountWarnings,
  };
}
