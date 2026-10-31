import { dateKey } from "@/lib/worker-validation";

export function sourceHeader(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
export function sourceMonth(value: unknown, interviewDate: string) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^T(0[1-9]|1[0-2])\.\d{4}$/.test(s)) return s;
  const match = /^Tháng\s+(0?[1-9]|1[0-2])(?:[\s/.\-]+(\d{4}))?$/i.exec(s);
  if (!match) throw new Error("Kỳ nhận việc cần dạng Tháng 05 hoặc T05.2026");
  const date = dateKey(interviewDate);
  const year = match[2] || date?.slice(0, 4);
  if (!year)
    throw new Error(
      "Tháng thiếu năm và ngày PV không có năm hợp lệ; cần xác nhận năm",
    );
  // Year comes from the same source row; never substitute the current year.
  return `T${match[1].padStart(2, "0")}.${year}`;
}

export const sourceStatuses = [
  "NH",
  "Bỏ XX",
  "GTNB",
  "Bỏ ĐT",
  "Trượt KSK",
  "Đỗ - Ko tính",
  "Đỗ - ko tính",
  "Ko theo dõi",
  "Hết Phí",
  "HHĐ",
  "Tự ý nghỉ việc",
  "Hết phí",
  "LV",
  "Bỏ KSK",
  "DS Đen",
  "Chuyển FIH",
  "Chưa ĐT",
];
export function sourceRewardAmount(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s) return 0;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Tiền thưởng không hợp lệ");
    return value;
  }
  const m = /^(\d{1,3}(?:[, .]\d{3})+|\d+)(?:\s*[-–].*|\s*(?:đ|VND))?$/i.exec(
    s,
  );
  if (m) return Number(m[1].replace(/[, .]/g, ""));
  if (/^(ko|không|hết|tặng)/i.test(s)) return 0;
  throw new Error("Nội dung thưởng chưa nhận diện: " + s);
}

const rewardHeaderCache = new Map<string, string>();
function normalizedRewardHeader(key: string) {
  const cached = rewardHeaderCache.get(key);
  if (cached !== undefined) return cached;
  const value = key.normalize("NFKC").toLocaleLowerCase("vi").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  if (rewardHeaderCache.size >= 256) rewardHeaderCache.clear();
  rewardHeaderCache.set(key, value);
  return value;
}

// Split-format columns take precedence, including explicitly blank amounts.
export function sourceRewardParts(row: Record<string, unknown>, stage: number) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [
    normalizedRewardHeader(key), value,
  ]));
  const splitKey = `tien thuong l${stage}`;
  return {
    split: normalized.has(splitKey),
    name: String(normalized.get(`ten thuong l${stage}`) ?? "").trim(),
    value: normalized.has(splitKey) ? normalized.get(splitKey) : normalized.get(`thuong lan ${stage}`),
    reason: String(normalized.get(`ly do l${stage}`) ?? "").trim(),
  };
}
export function sourceRewardText(row: Record<string, unknown>, stage: number) {
  const part = sourceRewardParts(row, stage);
  return part.split
    ? [part.name, String(part.value ?? "").trim(), part.reason].filter(Boolean).join(" | ")
    : String(part.value ?? "").trim();
}

export function parseSourceRewardAmount(value: unknown, label: string) {
  const source = String(value ?? "").trim();
  if (!source || /^[-–—]$/.test(source)) return { amount: 0 };

  let amount: number;
  try {
    amount = sourceRewardAmount(value);
  } catch (error: any) {
    if (error?.message === "Tiền thưởng không hợp lệ") throw error;
    const match =
      /([0-9]+(?:[.,][0-9]+)?)\s*(triệu|tr|million|m|nghìn|ngàn|k)(?=\s|$|[^\p{L}])/iu.exec(
        source,
      );
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


export function sourceBonusAmounts(raw: Record<string, unknown>) {
  const bonusResults = Array.from({ length: 7 }, (_, index) =>
    parseSourceRewardAmount(
      sourceRewardParts(raw, index + 1).value,
      `Thưởng lần ${index + 1}`,
    ),
  );
  const bonuses = bonusResults.map((result) => result.amount);
  const amountWarnings = bonusResults.flatMap((result) =>
    result.warning ? [result.warning] : [],
  );
  const totalCell = Object.entries(raw).find(([header]) => ["tong thuong", "tong tien thuong"].includes(normalizedRewardHeader(header)))?.[1];
  let totalBonus = bonuses.reduce((sum, amount) => sum + amount, 0);
  if (!Array.from({ length: 7 }, (_, i) => sourceRewardParts(raw, i + 1).split).some(Boolean) &&
      totalCell !== undefined && totalCell !== null && totalCell !== "") {
    const totalResult = parseSourceRewardAmount(totalCell, "Tổng thưởng");
    if (totalResult.warning) amountWarnings.push(totalResult.warning);
    else totalBonus = totalResult.amount;
  }
  if (!Number.isSafeInteger(totalBonus) || totalBonus < 0)
    throw new Error("Tổng thưởng vượt giới hạn số nguyên an toàn");

  return { bonuses, totalBonus, amountWarnings };
}
