const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const XLSX = require("xlsx");

function load(file, deps = {}, cache = {}) {
  if (cache[file]) return cache[file];
  const m = { exports: {} };
  cache[file] = m.exports;
  const source = fs.readFileSync(file, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(transpiled, {
    module: m,
    exports: m.exports,
    require: (n) => {
      if (n in deps) return deps[n];
      if (n.startsWith("@/")) return load("src/" + n.slice(2) + ".ts", deps, cache);
      return require(n);
    },
    process,
    Buffer,
    Date,
    Response,
    Map,
    Set,
    URL,
    URLSearchParams,
    console,
    crypto: require("node:crypto"),
  });
  return cache[file] = m.exports;
}

function createMockDeps(prismaMock = {}) {
  const completePrisma = {
    worker: { findMany: async () => [], createMany: async () => ({ count: 0 }), update: async () => ({}) },
    laborStatus: {
      findMany: async () => [
        { id: "st-working", name: "Đang làm việc", isActive: true, category: "WORKING" },
        { id: "st-waiting", name: "Đang chờ phỏng vấn", isActive: true, category: "NEW" },
        { id: "st-bo-ksk", name: "Bỏ khám sức khỏe", isActive: true, category: "STOP" },
      ],
      findUnique: async ({ where }) => {
        const list = [
          { id: "st-working", name: "Đang làm việc", isActive: true, category: "WORKING" },
          { id: "st-waiting", name: "Đang chờ phỏng vấn", isActive: true, category: "NEW" },
          { id: "st-bo-ksk", name: "Bỏ khám sức khỏe", isActive: true, category: "STOP" },
        ];
        if (where.id) return list.find(s => s.id === where.id) || null;
        if (where.name) return list.find(s => s.name === where.name) || { id: "st-auto", name: where.name, isActive: true, category: "SOURCE" };
        return null;
      },
      upsert: async ({ create }) => ({ id: "st-upsert", ...create, isActive: true }),
    },
    factory: { findMany: async () => [{ id: "fac-1", name: "Foxconn", isActive: true }, { id: "fac-2", name: "Luxshare", isActive: true }] },
    recruiter: { findMany: async () => [] },
    recruitmentTeam: { findMany: async () => [] },
    workAssignment: { createMany: async () => ({ count: 0 }), update: async () => ({}) },
    assignmentEvent: { createMany: async () => ({ count: 0 }) },
    bonusRecord: { findMany: async () => [], update: async () => ({}), updateMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    bankAccount: { findFirst: async () => null, createMany: async () => ({ count: 0 }), update: async () => ({}) },
    auditLog: { findUnique: async () => null, create: async () => ({}) },
    importProfile: { findFirst: async () => null },
    $transaction: async (fn) => fn(completePrisma),
    ...prismaMock,
  };
  return {
    "@/lib/prisma": { prisma: completePrisma },
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({
          status: init.status || 200,
          body,
          clone: () => ({
            status: init.status || 200,
            body,
            json: async () => body,
            text: async () => JSON.stringify(body),
          }),
          json: async () => body,
          text: async () => JSON.stringify(body),
        }),
      },
    },
  };
}

const mockHeaders = {
  get: (h) => {
    const k = String(h).toLowerCase();
    if (k === "host") return "127.0.0.1:3000";
    if (k === "origin") return "http://127.0.0.1:3000";
    return null;
  },
};

test("Fix 1: Canonical Status Mapping đúng nghiệp vụ từng trạng thái", () => {
  const { resolveCanonicalStatus } = load("src/lib/status-mapping.ts");

  const boKsk = resolveCanonicalStatus("Bỏ KSK");
  assert.equal(boKsk.canonicalName, "Bỏ khám sức khỏe");
  assert.equal(boKsk.category, "STOP");
  assert.equal(boKsk.endsAssignment, true);
  assert.equal(boKsk.warnsDuplicate, false);

  const dsDen = resolveCanonicalStatus("DS Đen");
  assert.equal(dsDen.canonicalName, "Danh sách đen");
  assert.equal(dsDen.category, "STOP");
  assert.equal(dsDen.endsAssignment, true);
  assert.equal(dsDen.warnsDuplicate, true, "DS Đen phải bật cờ warnsDuplicate để cảnh báo hồ sơ mới");

  const chuyenFih = resolveCanonicalStatus("Chuyển FIH");
  assert.equal(chuyenFih.canonicalName, "Chuyển xưởng");
  assert.equal(chuyenFih.category, "STOP");
  assert.equal(chuyenFih.endsAssignment, true);

  const chuaDt = resolveCanonicalStatus("Chưa ĐT");
  assert.equal(chuaDt.canonicalName, "Chưa đào tạo");
  assert.equal(chuaDt.category, "NEW");
  assert.equal(chuaDt.endsAssignment, false);

  const doKoTinhLower = resolveCanonicalStatus("Đỗ - ko tính");
  const doKoTinhUpper = resolveCanonicalStatus("Đỗ - Ko tính");
  assert.equal(doKoTinhLower.canonicalName, "Đỗ - Ko tính");
  assert.equal(doKoTinhUpper.canonicalName, "Đỗ - Ko tính", "Phải chuẩn hóa về cùng 1 tên chuẩn duy nhất");

  const hetPhiLower = resolveCanonicalStatus("Hết phí");
  const hetPhiUpper = resolveCanonicalStatus("Hết Phí");
  assert.equal(hetPhiLower.canonicalName, "Hết phí");
  assert.equal(hetPhiUpper.canonicalName, "Hết phí", "Hết Phí phải chuẩn hóa về Hết phí");
});

test("Fix 2: Từ chối tải lên nhiều sheet cùng loại với HTTP 400 thay vì âm thầm bỏ qua", async () => {
  const wb1 = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng"],
    ["Nguyen Van A", "001000000001", "VSIP", "01/10/2026", "Đang làm việc"],
  ]);
  XLSX.utils.book_append_sheet(wb1, ws1, "DS_TONG");
  const buf1 = XLSX.write(wb1, { type: "buffer", bookType: "xlsx" });

  const wb2 = XLSX.utils.book_new();
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng"],
    ["Tran Thi B", "001000000002", "VSIP", "02/10/2026", "Đang làm việc"],
  ]);
  XLSX.utils.book_append_sheet(wb2, ws2, "DS_TONG");
  const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });

  const file1 = { name: "DS_TONG_T9.xlsx", size: buf1.length, arrayBuffer: async () => buf1 };
  const file2 = { name: "DS_TONG_T10.xlsx", size: buf2.length, arrayBuffer: async () => buf2 };

  const route = load("src/app/api/excel-engine/import/route.ts", createMockDeps());

  const reqA = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: (k) => k === "files" ? [file1, file2] : [],
      get: () => null,
    }),
  };

  const resA = await route.POST(reqA);
  assert.equal(resA.status, 400);
  assert.equal(resA.body.success, false);
  assert.match(resA.body.message, /Cả 2 file tải lên đều là file Hồ sơ nhân sự \(DS_TONG\)/);

  const wbThuong = XLSX.utils.book_new();
  const wsTh1 = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy", "Ngày PV", "Thưởng lần 1"],
    ["Nguyen Van A", "001000000001", "VSIP", "01/10/2026", 500000],
  ]);
  const wsTh2 = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy", "Ngày PV", "Thưởng lần 1"],
    ["Tran Thi B", "001000000002", "VSIP", "02/10/2026", 500000],
  ]);
  XLSX.utils.book_append_sheet(wbThuong, wsTh1, "THUONG_D1");
  XLSX.utils.book_append_sheet(wbThuong, wsTh2, "THUONG_D2");
  const bufThuong = XLSX.write(wbThuong, { type: "buffer", bookType: "xlsx" });

  const fileThuongMulti = { name: "BangThuong_2Sheet.xlsx", size: bufThuong.length, arrayBuffer: async () => bufThuong };
  const reqB = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: (k) => k === "files" ? [fileThuongMulti] : [],
      get: () => null,
    }),
  };
  const resB = await route.POST(reqB);
  assert.equal(resB.status, 400);
  assert.equal(resB.body.success, false);
  assert.match(resB.body.message, /Phát hiện nhiều hơn 1 sheet Bảng thưởng \(DS_THUONG\)/);
});

test("Fix 3: Đếm chuẩn dòng lỗi khi cả 2 sheet có cùng số thứ tự dòng lỗi (kèm buildReviewBreakdown)", () => {
  const { splitImportReview } = load("src/lib/import-review.ts");

  const messages = [
    "[DS_TONG] Dòng 5: Trùng ngày PV tại hai công ty (khác nhà máy)",
    "[DS_THUONG] Dòng 5: Trùng ngày PV tại hai công ty (khác nhà máy)",
  ];

  const review = splitImportReview(messages);
  assert.equal(review.duplicates.length, 2);
  assert.equal(review.duplicateRows, 2, "Hai dòng lỗi ở 2 sheet khác nhau phải được đếm đủ là 2 dòng");
  assert.equal(review.reviewRows, 2, "reviewRows phải đếm đủ 2");
});

test("Fix 4 [P1]: Chống race condition & chống trùng STK trong DS_TONG khi một worker có nhiều đợt PV", async () => {
  const workerId = "worker-uuid-1";
  const existingWorker = {
    id: workerId,
    idCard: "001099000001",
    fullName: "Nguyễn Văn Test",
    assignments: [
      { id: "assign-1", workerId, interviewDate: "2026-09-01", interviewFactory: "Foxconn", status: "Đang chờ phỏng vấn" },
      { id: "assign-2", workerId, interviewDate: "2026-10-01", interviewFactory: "Foxconn", status: "Đang chờ phỏng vấn" },
    ],
    bankAccounts: [],
  };

  const createdBankAccounts = [];
  const mockDeps = createMockDeps({
    worker: {
      findMany: async () => [existingWorker],
      createMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    bankAccount: {
      findFirst: async () => null,
      createMany: async ({ data }) => {
        createdBankAccounts.push(...data);
        return { count: data.length };
      },
      update: async () => ({}),
    },
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng", "STK", "Ngân hàng"],
    ["Nguyễn Văn Test", "001099000001", "Foxconn", "01/09/2026", "Đang làm việc", "19033333333333", "Techcombank"],
    ["Nguyễn Văn Test", "001099000001", "Foxconn", "01/10/2026", "Đang làm việc", "19033333333333", "Techcombank"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "DS_TONG");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const file = { name: "DS_TONG.xlsx", size: buf.length, arrayBuffer: async () => buf };

  const route = load("src/app/api/excel-engine/import/route.ts", mockDeps);

  const req = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return file;
        if (k === "confirm") return "true";
        if (k === "importType") return "DS_TONG";
        if (k === "smartMerge") return "true";
        return null;
      },
    }),
  };

  const res = await route.POST(req);
  assert.equal(res.status, 200, `POST phải thành công: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.equal(createdBankAccounts.length, 1, "Chỉ được tạo đúng 1 bản ghi BankAccount duy nhất, không được tạo trùng!");
  assert.equal(createdBankAccounts[0].accountNumber, "19033333333333");
  assert.equal(createdBankAccounts[0].bankName, "Techcombank");
});

test("Fix 5 [P2]: DS_THUONG Smart Merge cập nhật đúng bankName khi tài khoản đã có nhưng thiếu tên ngân hàng", async () => {
  const workerId = "worker-uuid-2";
  const existingWorker = {
    id: workerId,
    idCard: "001099000002",
    fullName: "Lê Văn Thưởng",
    assignments: [
      { id: "assign-bonus-1", workerId, interviewDate: "2026-08-01", interviewFactory: "Luxshare", status: "Đang làm việc" },
    ],
    bankAccounts: [
      { id: "bank-acc-1", workerId, accountNumber: "0987654321", bankName: "Chưa xác định" },
    ],
  };

  const existingBonus = {
    id: "bonus-record-1",
    workerId,
    company: "Luxshare",
    interviewDate: "2026-08-01",
    month: "2026-08",
    assignmentId: "assign-bonus-1",
    totalBonus: 1000000,
    bonus1: 1000000,
    bonus2: 0,
    status: "DRAFT",
    note: JSON.stringify({ source: "SOURCE_EXCEL_ACTUAL_PAID" }),
  };

  const bankAccountUpdates = [];
  const mockDeps = createMockDeps({
    worker: {
      findMany: async () => [existingWorker],
      createMany: async () => ({ count: 0 }),
    },
    bonusRecord: {
      findMany: async () => [existingBonus],
      update: async () => ({}),
      createMany: async () => ({ count: 0 }),
    },
    bankAccount: {
      createMany: async () => ({ count: 0 }),
      update: async ({ where, data }) => {
        bankAccountUpdates.push({ where, data });
        return {};
      },
    },
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Công ty", "Ngày PV", "Tháng", "Thưởng lần 2", "Số tài khoản", "Ngân hàng"],
    ["Lê Văn Thưởng", "001099000002", "Luxshare", "01/08/2026", "T08.2026", 500000, "0987654321", "Vietcombank"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "DS_THUONG");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const file = { name: "DS_THUONG.xlsx", size: buf.length, arrayBuffer: async () => buf };

  const route = load("src/app/api/excel-engine/import/route.ts", mockDeps);

  const req = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return file;
        if (k === "confirm") return "true";
        if (k === "importType") return "DS_THUONG";
        if (k === "smartMerge") return "true";
        return null;
      },
    }),
  };

  const res = await route.POST(req);
  assert.equal(res.status, 200, `POST DS_THUONG phải thành công: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.equal(bankAccountUpdates.length, 1, "Phải có 1 thao tác cập nhật ngân hàng cho tài khoản có sẵn");
  assert.equal(bankAccountUpdates[0].where.id, "bank-acc-1");
  assert.equal(bankAccountUpdates[0].data.bankName, "Vietcombank");
});

test("Fix 6 [P1]: Chặn tuyển dụng ứng viên thuộc Danh sách đen và phát cảnh báo rõ ràng", async () => {
  const workerId = "worker-uuid-blacklist";
  const existingWorker = {
    id: workerId,
    idCard: "001099000003",
    fullName: "Trần Vi Phạm",
    assignments: [
      { id: "assign-bl", workerId, interviewDate: "2026-05-01", interviewFactory: "Công ty Cũ", status: "Danh sách đen" },
    ],
    bankAccounts: [],
  };

  const mockDeps = createMockDeps({
    worker: {
      findMany: async () => [existingWorker],
      createMany: async () => ({ count: 0 }),
    },
    laborStatus: {
      findMany: async () => [
        { id: "st-bl", name: "Danh sách đen", isActive: true, category: "STOP", warnsDuplicate: true, endsAssignment: true },
        { id: "st-work", name: "Đang làm việc", isActive: true, category: "WORKING", warnsDuplicate: true, endsAssignment: false },
      ],
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    factory: { findMany: async () => [{ id: "fac-1", name: "Công ty Mới", isActive: true }] },
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng"],
    ["Trần Vi Phạm", "001099000003", "Công ty Mới", "01/10/2026", "Đang làm việc"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "DS_TONG");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const file = { name: "DS_TONG.xlsx", size: buf.length, arrayBuffer: async () => buf };

  const route = load("src/app/api/excel-engine/import/route.ts", mockDeps);

  const req = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return file;
        if (k === "confirm") return "false";
        if (k === "importType") return "DS_TONG";
        return null;
      },
    }),
  };

  const res = await route.POST(req);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.duplicateCount, 1, "Ứng viên thuộc Danh sách đen phải được đếm vào duplicateCount");
  const blError = res.body.errors.find(e => e.includes("thuộc Danh sách đen"));
  assert.ok(blError, `Phải có thông báo lỗi thuộc Danh sách đen, nhận: ${JSON.stringify(res.body.errors)}`);
});

test("Fix 7 [P1]: Trạng thái 'Chưa đào tạo' / 'Chưa ĐT' không bị coi là active (isActiveAssignment = false)", () => {
  const { isActiveAssignment } = load("src/lib/duplicate-check.ts");

  const statuses = [
    { name: "Chưa đào tạo", category: "NEW", endsAssignment: false, warnsDuplicate: false },
    { name: "Đang làm việc", category: "WORKING", endsAssignment: false, warnsDuplicate: true },
  ];

  const assignChuaDt = { status: "Chưa ĐT", leaveDate: null };
  const assignChuaDaoTao = { status: "Chưa đào tạo", leaveDate: null };
  const assignDangLam = { status: "Đang làm việc", leaveDate: null };

  assert.equal(isActiveAssignment(assignChuaDt, statuses), false, "Chưa ĐT không được coi là đang hoạt động");
  assert.equal(isActiveAssignment(assignChuaDaoTao, statuses), false, "Chưa đào tạo không được coi là đang hoạt động");
  assert.equal(isActiveAssignment(assignDangLam, statuses), true, "Đang làm việc phải là đang hoạt động");
});

test("Fix 8 [P2]: AssignmentEvent lưu chuỗi trạng thái gốc khi có chuẩn hóa trạng thái", async () => {
  const eventsCreated = [];
  const mockDeps = createMockDeps({
    worker: {
      findMany: async () => [],
      createMany: async () => ({ count: 1 }),
    },
    laborStatus: {
      findMany: async () => [{ id: "st-bo-ksk", name: "Bỏ khám sức khỏe", isActive: true }],
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    factory: { findMany: async () => [{ id: "fac-1", name: "Luxshare", isActive: true }] },
    workAssignment: { createMany: async () => ({ count: 1 }) },
    assignmentEvent: {
      createMany: async ({ data }) => {
        eventsCreated.push(...data);
        return { count: data.length };
      },
    },
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng"],
    ["Hoàng Văn Chuẩn", "001099000004", "Luxshare", "01/10/2026", "Bỏ KSK"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "DS_TONG");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const file = { name: "DS_TONG.xlsx", size: buf.length, arrayBuffer: async () => buf };

  const route = load("src/app/api/excel-engine/import/route.ts", mockDeps);

  const req = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return file;
        if (k === "confirm") return "true";
        if (k === "importType") return "DS_TONG";
        return null;
      },
    }),
  };

  const res = await route.POST(req);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(eventsCreated.length, 1);
  assert.equal(eventsCreated[0].toStatus, "Bỏ khám sức khỏe", "toStatus phải là trạng thái chuẩn hóa");
  assert.match(
    eventsCreated[0].note,
    /Trạng thái nguồn "Bỏ KSK" -> chuẩn hóa "Bỏ khám sức khỏe"/,
    "note trong sự kiện phải lưu chuỗi trạng thái nguồn gốc phục vụ kiểm toán",
  );
});

test("Fix 9 [P1]: Hai file cùng có sheet tên 'Sheet1' (File 1: Tổng, File 2: Thưởng) -> không bị đọc nhầm sheet thưởng từ file tổng", async () => {
  const mockDeps = createMockDeps({
    factory: { findMany: async () => [{ id: "fac-1", name: "Luxshare", isActive: true }] },
    laborStatus: {
      findMany: async () => [{ id: "st-di-lam", name: "Đang làm việc", isActive: true }],
      findUnique: async () => null,
      upsert: async () => ({}),
    },
  });

  // File 1: Tổng (Sheet tên là 'Sheet1')
  const wb1 = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng"],
    ["Trần Văn A", "001099000001", "Luxshare", "01/10/2026", "Đang làm việc"],
  ]);
  XLSX.utils.book_append_sheet(wb1, ws1, "Sheet1");
  const buf1 = XLSX.write(wb1, { type: "buffer", bookType: "xlsx" });
  const file1 = { name: "DS_TONG.xlsx", size: buf1.length, arrayBuffer: async () => buf1 };

  // File 2: Thưởng (Sheet cũng tên là 'Sheet1')
  const wb2 = XLSX.utils.book_new();
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Công ty", "Ngày PV", "Tháng", "Thưởng lần 1"],
    ["Trần Văn A", "001099000001", "Luxshare", "01/10/2026", "T10.2026", 500000],
    ["Lê Văn B", "001099000002", "Luxshare", "01/10/2026", "T10.2026", 700000],
  ]);
  XLSX.utils.book_append_sheet(wb2, ws2, "Sheet1");
  const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
  const file2 = { name: "DS_THUONG.xlsx", size: buf2.length, arrayBuffer: async () => buf2 };

  const route = load("src/app/api/excel-engine/import/route.ts", mockDeps);

  const req = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return file1;
        if (k === "secondaryFile") return file2;
        if (k === "confirm") return "false";
        if (k === "importType") return "COMBINED";
        return null;
      },
    }),
  };

  const res = await route.POST(req);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.tongRows, 1, "Số dòng tổng phải là 1");
  assert.equal(res.body.summary.bonusRows, 2, "Số dòng thưởng phải là 2 (từ File 2 đã rename sang Sheet1_2)");
  const hasBonusError = (res.body.errors || []).some((err) =>
    err.includes("Thiếu tháng thưởng") || err.includes("tháng thưởng"),
  );
  assert.equal(hasBonusError, false, "Không được có lỗi 'Thiếu tháng thưởng' do đọc nhầm sheet tổng làm bảng thưởng");
});

test("Fix 10 [P2]: Chuẩn hóa trạng thái áp dụng cho cả lượt tuyển cũ được cập nhật qua Smart Merge", async () => {
  const assignmentUpdatesCaptured = [];
  const eventsCreated = [];

  const existingWorker = {
    id: "worker-old-1",
    fullName: "Nguyễn Văn Test",
    idCard: "001099887766",
    assignments: [
      {
        id: "assign-old-1",
        workerId: "worker-old-1",
        interviewDate: "01/10/2026",
        interviewFactory: "Luxshare",
        interviewResult: "PASS",
        status: "Đang chờ phỏng vấn",
        statusId: "st-waiting",
        employeeCode: null,
        leaveDate: null,
      },
    ],
    bankAccounts: [],
  };

  const mockDeps = createMockDeps({
    worker: {
      findMany: async () => [existingWorker],
      createMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
    laborStatus: {
      findMany: async () => [
        { id: "st-waiting", name: "Đang chờ phỏng vấn", isActive: true },
        { id: "st-bo-ksk", name: "Bỏ khám sức khỏe", isActive: true },
      ],
      findUnique: async ({ where }) => {
        if (where.name === "Bỏ khám sức khỏe") return { id: "st-bo-ksk", name: "Bỏ khám sức khỏe", isActive: true };
        if (where.name === "Đang chờ phỏng vấn") return { id: "st-waiting", name: "Đang chờ phỏng vấn", isActive: true };
        return null;
      },
      upsert: async () => ({}),
    },
    factory: { findMany: async () => [{ id: "fac-1", name: "Luxshare", isActive: true }] },
    workAssignment: {
      createMany: async () => ({ count: 0 }),
      update: async ({ where, data }) => {
        assignmentUpdatesCaptured.push({ where, data });
        return { ...existingWorker.assignments[0], ...data };
      },
    },
    assignmentEvent: {
      createMany: async ({ data }) => {
        eventsCreated.push(...data);
        return { count: data.length };
      },
    },
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Nhà máy PV", "Ngày PV", "Tình trạng"],
    ["Nguyễn Văn Test", "001099887766", "Luxshare", "01/10/2026", "Bỏ KSK"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "DS_TONG");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const file = { name: "DS_TONG.xlsx", size: buf.length, arrayBuffer: async () => buf };

  const route = load("src/app/api/excel-engine/import/route.ts", mockDeps);

  const req = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return file;
        if (k === "confirm") return "true";
        if (k === "importType") return "DS_TONG";
        if (k === "smartMerge") return "true";
        return null;
      },
    }),
  };

  const res = await route.POST(req);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.mergedCount, 1, "Phải ghi nhận 1 lượt tuyển Smart Merge");

  assert.equal(assignmentUpdatesCaptured.length, 1, "Phải gọi workAssignment.update 1 lần");
  assert.equal(
    assignmentUpdatesCaptured[0].data.status,
    "Bỏ khám sức khỏe",
    "Trạng thái cập nhật qua Smart Merge phải là chuẩn hóa 'Bỏ khám sức khỏe', KHÔNG ĐƯỢC là 'Bỏ KSK'",
  );
  assert.equal(
    assignmentUpdatesCaptured[0].data.statusId,
    "st-bo-ksk",
    "statusId cập nhật qua Smart Merge phải liên kết đúng ID danh mục 'st-bo-ksk'",
  );

  assert.equal(eventsCreated.length, 1, "Phải ghi nhận 1 sự kiện assignmentEvent");
  assert.equal(eventsCreated[0].toStatus, "Bỏ khám sức khỏe");
  assert.match(
    eventsCreated[0].note,
    /Trạng thái nguồn "Bỏ KSK" -> chuẩn hóa "Bỏ khám sức khỏe"/,
    "Sự kiện Smart Merge phải lưu vết cả chuỗi gốc và trạng thái chuẩn hóa",
  );
});
