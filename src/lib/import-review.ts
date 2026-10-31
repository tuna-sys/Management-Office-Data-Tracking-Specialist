export type ImportIssue = { row: number; message: string; kind: string; sheet?: string };

export function splitImportReview(messages: string[]) {
  const warnings: ImportIssue[] = [], duplicates: ImportIssue[] = [];
  for (const message of new Set(messages)) {
    const sheetMatch = /^\[(.*?)\]\s*/.exec(message);
    const sheet = sheetMatch ? sheetMatch[1] : undefined;
    const cleanMessage = sheetMatch ? message.slice(sheetMatch[0].length) : message;
    const row = Number(/^Dòng (\d+):/.exec(cleanMessage)?.[1] || 0);
    const duplicate = /Trùng SĐT|Trùng lặp nội bộ|Trùng ngày PV tại hai công ty|Khác mã theo công ty|Sai lệch danh tính|Lượt PV đã được người khác thêm|lượt.*đã có|STK trùng|Bản thưởng của đợt đã có|CHƯA BÁO NGHỈ|CẦN QUẢN LÝ XÁC NHẬN|nhảy sang|Danh sách đen|DS Đen/i.test(message);
    const kind = duplicate
      ? (/Danh sách đen|DS Đen/i.test(message)
        ? 'BLACKLIST'
        : /Trùng SĐT/i.test(message)
        ? 'PHONE'
        : /CHƯA BÁO NGHỈ|CẦN QUẢN LÝ XÁC NHẬN|nhảy sang/i.test(message)
        ? 'CROSS_COMPANY'
        : /STK|tài khoản/.test(message)
        ? 'BANK_ACCOUNT'
        : /Sai lệch danh tính/i.test(message)
        ? 'IDENTITY_MISMATCH'
        : /thưởng/.test(message)
        ? 'BONUS'
        : 'INTERNAL_DUPLICATE')
      : (/SĐT/i.test(message)
        ? 'PHONE_NOTICE'
        : 'DATA_WARNING');
    (duplicate ? duplicates : warnings).push({ row, message, kind, sheet });
  }
  const rowKey = (i: ImportIssue) => i.sheet ? `${i.sheet}:${i.row}` : String(i.row);
  const duplicateRowKeys = new Set(duplicates.map(rowKey));
  return {
    warnings,
    duplicates,
    warningRows: new Set(warnings.filter(i => !duplicateRowKeys.has(rowKey(i))).map(rowKey)).size,
    duplicateRows: duplicateRowKeys.size,
    reviewRows: new Set([...warnings, ...duplicates].map(rowKey)).size,
  };
}
