import {
  dateKey,
  normalizeCccd,
  formatExcelDate,
} from "@/lib/worker-validation";
import { sourceHeader, sourceBonusAmounts, sourceRewardParts, sourceRewardText } from "@/lib/source-format";
import { splitImportReview } from "@/lib/import-review";
const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("vi");
export function sourcePaidReport(
  sources: any[],
  workers: any[],
  imported: any[],
  p: URLSearchParams,
) {
  const people = new Map(workers.map((w) => [normalizeCccd(w.idCard), w]));
  const unique = new Map<string, any>();
  let skippedDuplicates = 0;
  for (const source of sources.filter((s) => s.type === "DS_THUONG"))
    for (const r of source.rows) {
      const v = Object.fromEntries(
        Object.entries(r.values || {}).map(([k, value]) => [
          sourceHeader(k),
          value,
        ]),
      );
      if (
        !Array.from({ length: 7 }, (_, i) => sourceRewardParts(v, i + 1)).some(
          (part) => part.split || part.value !== undefined,
        )
      )
        continue;
      if (
        splitImportReview([...(r.warnings || []), ...(r.duplicates || [])])
          .duplicates.length
      ) {
        skippedDuplicates++;
        continue;
      }
      const card = normalizeCccd(v["Số CCCD"] || v["số CCCD"] || v.CCCD || ""),
        company = String(v["Công ty"] || "").trim(),
        pv = formatExcelDate(v["Ngày PV"]),
        code = String(v["Mã nhân viên"] || v["Mã NV"] || "").trim();
      const rewards = Array.from({ length: 7 }, (_, i) =>
        sourceRewardText(v, i + 1),
      );
      const key =
        card && company
          ? JSON.stringify([card, norm(company), dateKey(pv), code])
          : `unlinked-${source.id}-${r.row}`;
      const signature = JSON.stringify(rewards.map(norm));
      if (unique.has(key)) {
        const old = unique.get(key);
        if (old.signature === signature) skippedDuplicates++;
        else old.conflicting = true;
        continue;
      }
      const worker = people.get(card);
      if (worker?.archivedAt) continue;
      const assignments = (worker?.assignments || []).filter(
        (a: any) =>
          norm(a.interviewFactory) === norm(company) &&
          dateKey(a.interviewDate || "") === dateKey(pv) &&
          (!code || String(a.employeeCode || worker.code || "") === code),
      );
      let paid = 0;
      let amountInvalid = false;
      const warnings: string[] = [];
      try {
        const amounts = sourceBonusAmounts(v);
        paid = amounts.totalBonus;
        warnings.push(...amounts.amountWarnings);
      } catch {
        amountInvalid = true;
        warnings.push("Có nội dung tiền chưa đọc được; cần đối chiếu");
      }
      unique.set(key, {
        id: `source-${source.id}-${r.row}`,
        key,
        signature,
        name: String(v["Họ tên"] || v["Họ và tên"] || worker?.fullName || ""),
        idCard: card,
        company,
        month: String(v.Tháng || ""),
        interviewDate: pv,
        workerCode: code,
        policy: String(v["Chính sách"] || ""),
        paid,
        amountInvalid,
        sourceRewards: rewards.join(" · "),
        sourceFile: source.file,
        sourceRow: r.row,
        linked: assignments.length === 1,
        assignment: assignments.length === 1 ? assignments[0] : null,
        worker,
        warnings,
        conflicting: false,
      });
    }
  // Retain older source imports without a raw snapshot; do not double count records already represented by source.
  for (const b of imported) {
    if (b.worker?.archivedAt) continue;
    let note: any;
    try {
      note = JSON.parse(b.note || "{}");
    } catch {
      continue;
    }
    if (note.source !== "SOURCE_EXCEL_ACTUAL_PAID") continue;
    const card = normalizeCccd(b.worker?.idCard || ""),
      company = String(b.company || "").trim(),
      pv = formatExcelDate(b.interviewDate || b.assignment?.interviewDate || ""),
      code = String(b.workerCode || "").trim();
    const key = JSON.stringify([card, norm(company), dateKey(pv), code]);
    const rawKey = JSON.stringify([
      card,
      norm(company),
      dateKey(formatExcelDate(b.interviewDate || "")),
      code,
    ]);
    if (unique.has(key) || unique.has(rawKey)) continue;
    unique.set(key, {
      id: b.id,
      key,
      name: b.worker?.fullName || "",
      idCard: card,
      company,
      month: note.monthOriginal || b.month,
      interviewDate: pv,
      workerCode: code,
      policy: b.policy,
      paid: b.totalBonus || 0,
      sourceRewards: (note.rewards || []).join(" · "),
      linked: !!b.assignment,
      assignment: b.assignment,
      worker: b.worker,
      warnings: [],
      conflicting: false,
    });
  }
  const selectedCompanyRaw = p.get("interviewFactory") || p.get("factory");
  const selectedCompanies = selectedCompanyRaw
    ? selectedCompanyRaw
        .split(",")
        .map((c) => norm(c))
        .filter(Boolean)
    : [];
  const rows = [...unique.values()]
    .filter((r) => {
      const d = dateKey(r.interviewDate);
      if (
        selectedCompanies.length > 0 &&
        !selectedCompanies.includes(norm(r.company))
      )
        return false;
      if (
        (p.get("month") && d?.slice(0, 7) !== p.get("month")) ||
        (p.get("from") && (!d || d < p.get("from")!)) ||
        (p.get("to") && (!d || d > p.get("to")!))
      )
        return false;
      if (p.get("orderId")) {
        const orderIds = p
          .get("orderId")!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (orderIds.length > 0 && !orderIds.includes(String(r.assignment?.orderId || "")))
          return false;
      }
      if (p.get("batchId")) {
        const batchItems = p
          .get("batchId")!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (batchItems.length > 0) {
          const matchedBatch = batchItems.some((item) => {
            if (String(r.assignment?.batchId || "").trim() === item) return true;
            if (String(r.assignment?.batch?.periodMonth || "").trim() === item)
              return true;
            const m = /^T(0[1-9]|1[0-2])\.(\d{4})$/i.exec(item);
            if (m) {
              return d?.slice(0, 7) === `${m[2]}-${m[1]}`;
            }
            return false;
          });
          if (!matchedBatch) return false;
        }
      }
      for (const key of ["recruiter", "team"])
        if (
          p.get(key) &&
          (r.assignment?.[key] || r.worker?.[key]) !== p.get(key)
        )
          return false;
      if (
        p.get("search") &&
        ![r.name, r.idCard, r.workerCode].some((v) =>
          norm(v).includes(norm(p.get("search"))),
        )
      )
        return false;
      return true;
    })
    .map(({ signature, key, assignment, worker, ...r }) => ({
      ...r,
      status: r.conflicting
        ? "Khoản khác nhau cùng hồ sơ — chờ đối chiếu"
        : r.warnings.length
          ? "Cần kiểm tra số tiền"
          : r.linked
            ? "Đã liên kết hồ sơ"
            : "Nguồn Excel — chưa liên kết đợt",
      counted: !r.conflicting && !r.amountInvalid,
    }));
  const groups = new Map<string, any>();
  for (const r of rows) {
    const g = groups.get(r.company) || {
      name: r.company || "Chưa xác định công ty",
      rows: 0,
      paid: 0,
      unlinked: 0,
      pending: 0,
    };
    g.rows++;
    if (r.counted) g.paid += r.paid;
    if (!r.counted || r.warnings.length) g.pending++;
    if (!r.linked) g.unlinked++;
    groups.set(r.company, g);
  }
  return {
    total: rows.filter((r) => r.counted).reduce((n, r) => n + r.paid, 0),
    rows,
    companies: [...groups.values()],
    unlinked: rows.filter((r) => !r.linked).length,
    pending: rows.filter((r) => !r.counted || r.warnings.length).length,
    skippedDuplicates,
  };
}
