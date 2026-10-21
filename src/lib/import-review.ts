export type ImportIssue = { row: number; message: string; kind: string };

export function splitImportReview(messages: string[]) {
  const warnings: ImportIssue[] = [], duplicates: ImportIssue[] = [];
  for (const message of new Set(messages)) {
    const row = Number(/^Dòng (\d+):/.exec(message)?.[1] || 0);
    const duplicate = /Trùng SĐT|Trùng lặp nội bộ|Sai lệch danh tính|Lượt PV đã được người khác thêm|lượt.*đã có|STK trùng|Bản thưởng của đợt đã có|CHƯA BÁO NGHỈ|CẦN QUẢN LÝ XÁC NHẬN|nhảy sang/i.test(message);
    const kind = duplicate
      ? (/Trùng SĐT/i.test(message) ? 'PHONE' : /CHƯA BÁO NGHỈ|CẦN QUẢN LÝ XÁC NHẬN|nhảy sang/i.test(message)
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
    (duplicate ? duplicates : warnings).push({ row, message, kind });
  }
  const duplicateRowNumbers = new Set(duplicates.map(i => i.row));
  return {
    warnings,
    duplicates,
    warningRows: new Set(warnings.filter(i => !duplicateRowNumbers.has(i.row)).map(i => i.row)).size,
    duplicateRows: duplicateRowNumbers.size,
    reviewRows: new Set([...warnings, ...duplicates].map(i => i.row)).size,
  };
}
