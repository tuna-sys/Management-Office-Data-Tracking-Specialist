import { sourceHeader, sourceMonth } from "@/lib/source-format";
import * as XLSX from "xlsx";
import {
  cleanFields,
  WORKER_FIELDS,
  ASSIGNMENT_FIELDS,
  validateWorker,
  validateInterview,
  normalizeCccd,
  formatExcelDate,
} from "@/lib/worker-validation";
const mappings: Record<string, string[]> = {
  fullName: ["Họ và tên", "Họ tên"],
  idCard: ["số CCCD", "Số CCCD", "CCCD", "CMT/CCCD"],
  phone: ["SĐT", "Số điện thoại"],
  code: ["Mã NV"],
  dob: ["Ngày sinh"],
  gender: ["Giới tính"],
  idCardDate: ["Ngày cấp"],
  idCardPlace: ["Nơi cấp"],
  address: ["Địa chỉ"],
  province: ["Tỉnh/Thành"],
  recruiter: ["Tuyển dụng", "Tuyển Dụng"],
  source: ["Nguồn"],
  interviewFactory: ["Nhà máy PV", "Công ty"],
  contractType: ["Loại HD", "Loại HĐ"],
  status: ["Tình trạng", "TT"],
  leaveDate: ["Ngày NH"],
  leaveReason: ["Lý do"],
  shuttleBusKtx: ["Đón xe - KTX", "Đón xe + KTX"],
  interviewDate: ["Ngày PV", "Ngày phỏng vấn"],
  passedDate: ["Ngày đỗ", "Ngày PV đỗ"],
  interviewResult: ["Kết quả PV", "Kết Quả PV"],
  employeeCode: ["Mã nhân viên tại công ty", "Mã nhân viên"],
  team: ["Team", "Đội nhóm"],
  startDate: ["Ngày bắt đầu làm", "Ngày vào làm"],
  orderId: ["Mã liên kết đơn hàng"],
  batchId: ["Mã liên kết đợt"],
  expectedTrainingDate: ["Ngày Đào tạo dự kiến"],
  expectedTrainingStatus: [
    "Tình trạng Đào tạo dự kiến",
    "Tình trạng đào tạo",
    "TT ĐT dự kiến",
  ],
  standardTrainingDate: ["Ngày đào tạo chuẩn"],
  onboardingMonth: ["Tháng nhận việc", "Tháng"],
};
const dates = [
  "dob",
  "idCardDate",
  "leaveDate",
  "interviewDate",
  "expectedTrainingDate",
  "standardTrainingDate",
  "passedDate",
  "startDate",
];
function normalizeImportHeader(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[+‐‑‒–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function parseImportRow(
  raw: Record<string, unknown>,
  sourceImport = false,
) {
  const row = new Map(
    Object.entries(raw).map(([k, v]) => [
      normalizeImportHeader(sourceHeader(k)),
      v,
    ]),
  );
  const body: Record<string, string> = {};
  for (const [field, headers] of Object.entries(mappings)) {
    let v = headers
      .map((h) => row.get(normalizeImportHeader(h)))
      .find((v) => v !== undefined && v !== null && v !== "");
    if (v === undefined) continue;
    if (!sourceImport && ["idCard", "phone"].includes(field) && typeof v === "number")
      throw new Error(
        `${field === "idCard" ? "CCCD" : "SĐT"} phải lưu dạng Text để bảo toàn số 0 đầu; không tự khôi phục số thiếu`,
      );
    if (field === "idCard") {
      v = normalizeCccd(v);
    } else if (field === "phone") {
      let p = String(v).trim().replace(/[\s().-]/g, "");
      if (typeof v === "number" && p.length === 9) p = "0" + p;
      v = p;
    } else if (dates.includes(field)) {
      v = formatExcelDate(v);
    }
    body[field] = String(v).trim();
  }
  if (!body.province && body.address) {
    const inferred = inferProvince(body.address);
    if (inferred) body.province = inferred;
  }
  if (body.onboardingMonth)
    body.onboardingMonth = sourceMonth(
      body.onboardingMonth,
      body.interviewDate || "",
    );
  const results: Record<string, string> = {
    Đỗ: "PASS",
    "Đạt phỏng vấn": "PASS",
    Trượt: "FAIL",
    "Trượt phỏng vấn": "FAIL",
    Bỏ: "ABANDONED",
    "Bỏ phỏng vấn": "ABANDONED",
    "Chờ kết quả": "PENDING",
    "Chưa xác nhận": "UNKNOWN",
  };
  if (body.interviewResult)
    body.interviewResult =
      results[body.interviewResult] || body.interviewResult;
  else if (
    ["Đỗ", "Đạt phỏng vấn", "Trượt phỏng vấn", "Bỏ phỏng vấn"].includes(
      body.status,
    )
  )
    body.interviewResult = results[body.status];
  if (body.interviewResult === "PASS" && !body.passedDate)
    body.passedDate = body.interviewDate || "";
  const worker = cleanFields(body, WORKER_FIELDS);
  worker.idCard = body.idCard || "";
  const assignment = cleanFields(body, ASSIGNMENT_FIELDS);
  assignment.employeeCode ||= body.employeeCode || body.code || "";
  assignment.team ||= body.team || "";
  assignment.status ||= "Đang chờ phỏng vấn";
  validateWorker(worker, assignment, !sourceImport, sourceImport);
  if (!sourceImport) validateInterview(assignment);
  if (
    !sourceImport &&
    ![
      "Đã nghỉ việc",
      "Nghỉ hẳn",
      "Hết hợp đồng",
      "Bỏ xưởng",
      "Bỏ vì sức khỏe",
      "Hết phí",
    ].includes(assignment.status)
  ) {
    assignment.leaveDate = "";
    assignment.leaveReason = "";
  }
  return { worker, assignment };
}

// Same extraction for import and comparison; the full address is kept separately.
export function inferProvince(address: string): string {
  const parts = String(address || "").split(/[,-]/).map(s => s.trim()).filter(Boolean);
  const last = (parts[parts.length - 1] || "").replace(/^(tỉnh|thành phố|tp\.?|t\.p)\s+/i, "").trim();
  return last.length >= 2 && !/^\d+$/.test(last) ? last : "";
}
