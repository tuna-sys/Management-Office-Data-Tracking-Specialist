export const STATUSES = [
  "Đang chờ phỏng vấn",
  "Đạt phỏng vấn",
  "Đang làm việc",
  "Đã nghỉ việc",
  "Trượt phỏng vấn",
  "Bỏ phỏng vấn",
  "Bỏ đào tạo",
  "Bỏ khác",
  "Bỏ xưởng",
  "Bỏ vì sức khỏe",
  "Nghỉ hẳn",
  "Hết hợp đồng",
  "Hết phí",
  "Đỗ",
  "Chờ xử lý/tiếp nhận mới",
  "Đang đào tạo",
  "Chưa đào tạo",
  "Đợi tháng mới",
  "Chuyển chính thức",
];
export const WORKER_FIELDS = [
  "code",
  "fullName",
  "dob",
  "gender",
  "idCardDate",
  "idCardPlace",
  "phone",
  "address",
  "province",
  "recruiter",
  "team",
  "source",
] as const;
export const ASSIGNMENT_FIELDS = [
  "interviewFactory",
  "workingFactory",
  "contractType",
  "status",
  "leaveDate",
  "leaveReason",
  "shuttleBusKtx",
  "interviewDate",
  "expectedTrainingDate",
  "expectedTrainingStatus",
  "standardTrainingDate",
  "onboardingMonth",
  "recruiter",
  "source",
  "orderId",
  "batchId",
  "team",
  "employeeCode",
  "interviewResult",
  "passedDate",
  "startDate",
  "recruiterId",
  "teamId",
] as const;
export function phoneKey(value: string) {
  const digits = value.replace(/[\s().-]/g, "");
  return digits.startsWith("+84") ? "0" + digits.slice(3) : digits;
}
export function cleanFields(
  body: any,
  fields: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields)
    if (body[field] !== undefined) {
      if (body[field] === null) {
        result[field] = "";
        continue;
      }
      if (typeof body[field] !== "string" || body[field].length > 1000)
        throw new Error(`Trường ${field} không hợp lệ`);
      result[field] = body[field].trim();
    }
  if (result.phone) result.phone = phoneKey(result.phone);
  return result;
}
export function normalizeCccd(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim().replace(/\s+/g, '');
  if (/^\d{10,11}$/.test(s)) return s.padStart(12, '0');
  if (/^\d{7,8}$/.test(s)) return s.padStart(9, '0');
  return s;
}

export function formatExcelDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{4,5}$/.test(value.trim()))) {
    const num = Number(value);
    if (num > 20000 && num < 80000) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${day}/${m}/${y}`;
    }
  }
  return String(value).trim();
}

export function dateKey(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4,5}$/.test(s)) {
    const num = Number(s);
    if (num > 20000 && num < 80000) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  const vn = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (!iso && !vn) return null;
  const y = Number(iso ? iso[1] : vn![3]),
    m = Number(iso ? iso[2] : vn![2]),
    d = Number(iso ? iso[3] : vn![1]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1900 ||
    y > 2100 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function validateWorker(
  worker: Record<string, any>,
  assignment: Record<string, any>,
  requireIdentity = true,
  sourceImport = false,
) {
  if (
    requireIdentity &&
    (!worker.fullName ||
      typeof worker.idCard !== "string" ||
      !/^(\d{9}|\d{12})$/.test(worker.idCard))
  )
    throw new Error("Họ tên và CCCD 12 số hoặc CMT cũ 9 số là bắt buộc");
  if (!sourceImport && worker.phone && !/^0\d{9,10}$/.test(worker.phone))
    throw new Error("Số điện thoại không hợp lệ");
  if (!assignment.interviewFactory)
    throw new Error("Cần chọn nhà máy phỏng vấn");
  if (
    typeof assignment.status !== "string" ||
    !assignment.status.trim() ||
    assignment.status.length > 100
  )
    throw new Error("Tình trạng không hợp lệ");
  if (
    assignment.onboardingMonth &&
    !/^T(0[1-9]|1[0-2])\.\d{4}$/.test(assignment.onboardingMonth)
  )
    throw new Error("Kỳ nhận việc không hợp lệ");
  for (const field of ["dob", "idCardDate"])
    if (!sourceImport && worker[field] && !dateKey(worker[field]))
      throw new Error(
        `Ngày ${field} không hợp lệ (dd/mm/yyyy hoặc yyyy-mm-dd)`,
      );
  for (const field of [
    "leaveDate",
    "interviewDate",
    "expectedTrainingDate",
    "standardTrainingDate",
  ])
    if (!sourceImport && assignment[field] && !dateKey(assignment[field]))
      throw new Error(
        `Ngày ${field} không hợp lệ (dd/mm/yyyy hoặc yyyy-mm-dd)`,
      );
  if (
    !sourceImport &&
    [
      "Đã nghỉ việc",
      "Nghỉ hẳn",
      "Hết hợp đồng",
      "Bỏ xưởng",
      "Bỏ vì sức khỏe",
      "Hết phí",
    ].includes(assignment.status) &&
    (!assignment.leaveDate || !assignment.leaveReason)
  )
    throw new Error("Cần ngày nghỉ và lý do nghỉ việc");
  if (
    !sourceImport &&
    assignment.leaveDate &&
    assignment.interviewDate &&
    dateKey(assignment.leaveDate)! < dateKey(assignment.interviewDate)!
  )
    throw new Error("Ngày nghỉ không được trước ngày phỏng vấn");
}

export function validateInterview(a: Record<string, any>) {
  const result = a.interviewResult || "UNKNOWN";
  if (!["UNKNOWN", "PENDING", "PASS", "FAIL", "ABANDONED"].includes(result))
    throw new Error("Kết quả PV không hợp lệ");
  const interview = dateKey(a.interviewDate || ""),
    passed = dateKey(a.passedDate || ""),
    start = dateKey(a.startDate || "");
  if (a.passedDate && !passed) throw new Error("Ngày đỗ không hợp lệ");
  if (result === "PASS" && (!interview || !passed || passed < interview))
    throw new Error("Cần ngày PV và ngày đỗ không trước ngày PV");
  if (result !== "PASS" && a.passedDate)
    throw new Error("Ngày đỗ chỉ dùng cho kết quả Đỗ");
  if (a.startDate && (!start || !passed || start <= passed))
    throw new Error("Ngày bắt đầu làm phải sau ngày phỏng vấn đỗ");
  if (a.leaveDate && start && dateKey(a.leaveDate)! < start)
    throw new Error("Ngày nghỉ không được trước ngày làm");
  if (a.status === "Trượt phỏng vấn" && result !== "FAIL")
    throw new Error("Trượt phỏng vấn cần kết quả Trượt");
  if (a.status === "Bỏ phỏng vấn" && result !== "ABANDONED")
    throw new Error("Bỏ phỏng vấn cần kết quả Bỏ");
}
