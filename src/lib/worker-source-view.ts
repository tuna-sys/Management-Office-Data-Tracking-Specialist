import { sourceHeader } from "@/lib/source-format";
export const workerSourceColumns = [
  "STT",
  "Nhà máy PV",
  "Nhà máy làm việc",
  "Loại HĐ",
  "Tình trạng",
  "Ngày NH",
  "Lý do",
  "Mã NV",
  "Họ và tên",
  "Ngày sinh",
  "Giới tính",
  "Số CCCD",
  "Ngày cấp",
  "Địa chỉ",
  "SĐT",
  "Tuyển dụng",
  "Đón xe + KTX",
  "Ngày PV",
  "Ngày Đào tạo dự kiến",
  "Tình trạng đào tạo",
  "Ngày đào tạo chuẩn",
  "Tháng nhận việc",
];
const fields: Record<string, string> = {
  "Nhà máy PV": "interviewFactory",
  "Nhà máy làm việc": "workingFactory",
  "Loại HĐ": "contractType",
  "Tình trạng": "status",
  "Ngày NH": "leaveDate",
  "Lý do": "leaveReason",
  "Mã NV": "employeeCode",
  "Họ và tên": "fullName",
  "Ngày sinh": "dob",
  "Giới tính": "gender",
  "Số CCCD": "idCard",
  "Ngày cấp": "idCardDate",
  "Địa chỉ": "address",
  SĐT: "phone",
  "Tuyển dụng": "recruiter",
  "Đón xe + KTX": "shuttleBusKtx",
  "Ngày PV": "interviewDate",
  "Ngày Đào tạo dự kiến": "expectedTrainingDate",
  "Tình trạng đào tạo": "expectedTrainingStatus",
  "Ngày đào tạo chuẩn": "standardTrainingDate",
  "Tháng nhận việc": "onboardingMonth",
};
function sourceHeaderKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("vi")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[+‐‑‒–—/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const sourceHeaderAliases = new Map<string, string>();
for (const column of workerSourceColumns)
  sourceHeaderAliases.set(sourceHeaderKey(column), column);
for (const [column, aliases] of [
  ["Đón xe + KTX", ["Đón xe - KTX", "Đón xe / KTX", "Đón xe KTX"]],
  [
    "Tình trạng đào tạo",
    ["Tình trạng Đào tạo dự kiến", "TT ĐT dự kiến"],
  ],
] as const)
  for (const alias of aliases)
    sourceHeaderAliases.set(sourceHeaderKey(alias), column);

export function normalizeWorkerSourceValues(values: Record<string, unknown>) {
  const entries = Object.entries(values || {});
  const result: Record<string, unknown> = Object.fromEntries(
    entries.map(([key, value]) => [sourceHeader(key), value]),
  );
  for (const [key, value] of entries) {
    const canonical = sourceHeaderAliases.get(sourceHeaderKey(key));
    if (!canonical) continue;
    const current = result[canonical];
    const exactCanonical = sourceHeaderKey(key) === sourceHeaderKey(canonical);
    if (
      exactCanonical ||
      current === undefined ||
      current === null ||
      current === ""
    )
      result[canonical] = value;
  }
  return result;
}
export function workerSourceView(worker: any, assignment: any) {
  const result: Record<string, unknown> = {};
  for (const [name, key] of Object.entries(fields))
    result[name] = assignment[key] ?? worker[key] ?? "";
  let warnings: string[] = [];
  let hasSource = false;
  for (const event of assignment.events || []) {
    if (!event.note?.startsWith("Import Excel — source:")) continue;
    try {
      const snapshot = JSON.parse(
        event.note.slice("Import Excel — source:".length),
      );
      Object.assign(result, normalizeWorkerSourceValues(snapshot.values || {}));
      warnings = snapshot.warnings || [];
      hasSource = true;
      break;
    } catch {}
  }
  return { values: result, warnings, hasSource };
}
