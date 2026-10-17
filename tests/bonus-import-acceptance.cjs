const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const XLSX = require("xlsx");

function load(file, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
        return deps[name];
      },
      Buffer,
      Date,
      URL,
      console,
      process,
    },
  );
  return module.exports;
}

const validation = load("src/lib/worker-validation.ts");
const sourceFormat = load("src/lib/source-format.ts", {
  "@/lib/worker-validation": validation,
});
const bonusImport = load("src/lib/bonus-import.ts", {
  xlsx: XLSX,
  "@/lib/source-format": sourceFormat,
});
const raw = {
  STT: 7,
  "Công ty": "Canon",
  Tháng: "T05.2026",
  "Ngày PV": "04/05/2026",
  "Chính sách": "Chính sách QA",
  "Mã nhân viên": "CODE-FROM-FILE",
  "Họ tên": "Nguyễn Văn A",
  "Số CCCD": "000000000001",
  STK: "000123456789",
  "Ngân hàng": "QA Bank",
  "Thưởng lần 1": "Xét 1 tháng - 2tr - 25/10",
  "Thưởng lần 2": "—",
  "Thưởng lần 3": "Ck - 500k - Đã chốt 16/09",
  "Thưởng lần 4": "Đang chờ xác nhận từ công ty",
  "Thưởng lần 5": 50000,
  "Thưởng lần 6": "-",
  "Thưởng lần 7": 25000,
};
const parsed = bonusImport.parseBonusImportRow(raw);
assert.equal(parsed.sequence, "7");
assert.equal(parsed.company, "Canon");
assert.equal(parsed.month, "T05.2026");
assert.equal(parsed.interviewDate, "04/05/2026");
assert.equal(parsed.policy, "Chính sách QA");
assert.equal(parsed.workerCode, "CODE-FROM-FILE");
assert.equal(parsed.fullName, "Nguyễn Văn A");
assert.equal(parsed.idCard, "000000000001");
assert.equal(parsed.accountNumber, "000123456789");
assert.equal(parsed.bankName, "QA Bank");
assert.deepEqual(
  Array.from(parsed.bonuses),
  [2000000, 0, 500000, 0, 50000, 0, 25000],
);
assert.equal(parsed.totalBonus, 2575000);
assert.equal(parsed.amountWarnings.length, 1);
assert.match(parsed.amountWarnings[0], /không suy ra được số tiền/);
const statusRaw = {
  ...raw,
  STT: 8,
  Tháng: "T06.2026",
  ...Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [
      `Thưởng lần ${index + 1}`,
      index % 2 === 0 ? "Ko có chính sách thưởng" : "Hết chính sách thưởng",
    ]),
  ),
};
const parsedStatuses = bonusImport.parseBonusImportRow(statusRaw);
assert.deepEqual(Array.from(parsedStatuses.bonuses), [0, 0, 0, 0, 0, 0, 0]);
assert.equal(parsedStatuses.totalBonus, 0);

const worker = {
  id: "worker-1",
  code: "WORKER-CODE",
  fullName: "Nguyễn Văn A",
  idCard: "000000000001",
  assignments: [
    {
      id: "assignment-1",
      interviewFactory: "Canon",
      workingFactory: "Canon",
      interviewDate: "04/05/2026",
      employeeCode: "DB-CODE",
    },
  ],
};
const unresolvedWorker = {
  ...worker,
  id: "worker-2",
  idCard: "000000000002",
  assignments: [],
};
const writtenBonuses = [];
const writtenBanks = [];
const savedWarnings = [];
const createdWorkers = [];
const guardedPermissions = [];
const prisma = {
  importProfile: { findUnique: async () => null },
  worker: {
    findMany: async () => [worker, unresolvedWorker],
    findUnique: async ({ where }) =>
      createdWorkers.find((item) => item.idCard === where.idCard) || null,
    create: async ({ data }) => {
      const created = { id: "worker-3", ...data, assignments: [] };
      createdWorkers.push(created);
      return created;
    },
  },
  bonusRecord: {
    findMany: async () => [],
    create: async ({ data }) => {
      writtenBonuses.push(data);
      return { id: `bonus-${writtenBonuses.length}`, ...data };
    },
  },
  bankAccount: {
    findFirst: async () => null,
    create: async ({ data }) => writtenBanks.push(data),
  },
  auditLog: { create: async () => ({}) },
  $transaction: async (callback) => callback(prisma),
};
const review = {
  splitImportReview: (items) => ({
    warnings: [],
    duplicates: [],
    duplicateRows: 0,
    warningRows: 0,
    reviewRows: 0,
  }),
};
const route = load("src/app/api/excel-engine/import/route.ts", {
  "@/lib/import-review": review,
  "@/lib/import-source-store": {
    saveImportSource: async (type, file, sheet, rows, warnings) => {
      savedWarnings.push(...warnings);
      return "source-1";
    },
  },
  "@/lib/source-format": sourceFormat,
  "@/lib/worker-validation": validation,
  "@/lib/factory-matching": {
    matchFactory: (a, b) =>
      String(a || "").toLowerCase() === String(b || "").toLowerCase(),
  },
  "next/server": {
    NextResponse: {
      json: (body, options = {}) => ({ body, status: options.status || 200 }),
    },
  },
  "@/lib/prisma": { prisma },
  "@/lib/bonus-import": bonusImport,
  xlsx: XLSX,
  "@/lib/auth": {
    guard: async (_request, permission) => {
      if (permission) guardedPermissions.push(permission);
      return null;
    },
    identity: async () => ({ username: "QA" }),
  },
  "@/lib/worker-import": { parseImportRow: () => ({}) },
  "@/lib/domain": {
    assignmentRelations: async () => {},
    today: () => "2026-10-17",
    day: (v) => v,
  },
});

const sheet = XLSX.utils.aoa_to_sheet([
  Object.keys(raw),
  Object.values(raw),
  Object.values(statusRaw),
  Object.values({ ...raw, STT: 9, "Số CCCD": "000000000002" }),
  Object.values({ ...raw, STT: 10, "Số CCCD": "000000000003" }),
]);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "DS_THUONG");
const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
const file = {
  name: "DS_THUONG.xlsx",
  size: bytes.length,
  arrayBuffer: async () => bytes,
};
const makeRequest = (confirm) => ({
  formData: async () => ({
    get: (key) =>
      ({ file, confirm: confirm ? "true" : "false", importType: "DS_THUONG" })[
        key
      ],
  }),
});

(async () => {
  const preview = await route.POST(makeRequest(false));
  assert.equal(preview.body.detectedType, "DS_THUONG");
  assert.equal(preview.body.summary.readyCount, 4);
  assert.equal(preview.body.summary.newWorkerCount, 1);
  assert.equal(writtenBonuses.length, 0);

  const committed = await route.POST(makeRequest(true));
  assert.equal(committed.body.success, true);
  assert.equal(committed.body.summary.successCount, 4);
  assert.equal(writtenBonuses.length, 4);
  const saved = writtenBonuses[0];
  assert.equal(saved.workerId, "worker-1");
  assert.equal(saved.assignmentId, "assignment-1");
  assert.equal(saved.company, "Canon");
  assert.equal(saved.month, "T05.2026");
  assert.equal(saved.interviewDate, "04/05/2026");
  assert.equal(saved.policy, "Chính sách QA");
  assert.equal(saved.workerCode, "CODE-FROM-FILE");
  assert.equal(writtenBanks[0].accountNumber, "000123456789");
  assert.equal(writtenBanks[0].bankName, "QA Bank");
  assert.deepEqual(
    [
      saved.bonus1,
      saved.bonus2,
      saved.bonus3,
      saved.bonus4,
      saved.bonus5,
      saved.bonus6,
      saved.bonus7,
    ],
    [2000000, 0, 500000, 0, 50000, 0, 25000],
  );
  assert.equal(saved.totalBonus, 2575000);
  const source = JSON.parse(saved.note);
  assert.equal(source.sequence, "7");
  assert.equal(source.sourceValues["Họ tên"], "Nguyễn Văn A");
  assert.equal(source.sourceValues["Số CCCD"], "000000000001");
  assert.equal(source.sourceValues.STK, "000123456789");
  assert.equal(source.sourceValues["Ngân hàng"], "QA Bank");
  assert.equal(source.rewards[0], "Xét 1 tháng - 2tr - 25/10");
  assert.equal(source.rewards[2], "Ck - 500k - Đã chốt 16/09");
  assert.equal(source.rewards[3], "Đang chờ xác nhận từ công ty");
  assert.ok(savedWarnings.some((warning) => warning.includes("Thưởng lần 4")));
  const statusSaved = writtenBonuses[1];
  assert.deepEqual(
    [
      statusSaved.bonus1,
      statusSaved.bonus2,
      statusSaved.bonus3,
      statusSaved.bonus4,
      statusSaved.bonus5,
      statusSaved.bonus6,
      statusSaved.bonus7,
    ],
    [0, 0, 0, 0, 0, 0, 0],
  );
  const statusSource = JSON.parse(statusSaved.note);
  assert.equal(statusSource.rewards[0], "Ko có chính sách thưởng");
  assert.equal(statusSource.rewards[1], "Hết chính sách thưởng");
  assert.equal(statusSource.rewards[6], "Ko có chính sách thưởng");
  assert.equal(writtenBonuses[2].workerId, "worker-2");
  assert.equal(writtenBonuses[2].assignmentId, null);
  assert.ok(savedWarnings.some((warning) => warning.includes("chưa gắn đợt")));
  assert.equal(createdWorkers.length, 1);
  assert.equal(createdWorkers[0].idCard, "000000000003");
  assert.equal(createdWorkers[0].fullName, "Nguyễn Văn A");
  assert.equal(writtenBonuses[3].workerId, "worker-3");
  assert.equal(writtenBonuses[3].assignmentId, null);
  assert.ok(guardedPermissions.includes("worker:write"));
  const bonusListRoute = load("src/app/api/bonuses/route.ts", {
    "@/lib/auth": {
      guard: async () => null,
      identity: async () => ({ username: "QA" }),
    },
    "@/lib/prisma": {
      prisma: {
        bonusRecord: {
          findMany: async () =>
            writtenBonuses.map((record) => ({
              ...record,
              worker:
                record.workerId === unresolvedWorker.id
                  ? unresolvedWorker
                  : worker,
            })),
        },
      },
    },
    "@/lib/payment-safety": {
      canTransition: () => true,
      validAmount: () => true,
      validMonth: () => true,
    },
    "@/lib/worker-validation": { dateKey: () => null },
    "next/server": {
      NextResponse: {
        json: (body, options = {}) => ({ body, status: options.status || 200 }),
      },
    },
  });
  const listed = await bonusListRoute.GET({
    url: "http://localhost/api/bonuses",
  });
  assert.equal(listed.body.data.length, 4);
  assert.ok(listed.body.data.some((record) => record.assignmentId === null));
  assert.equal(writtenBanks.length, 4);
  console.log(
    "PASS DS_THUONG preview/commit, all 17 columns, numeric/dash/text reward cells retained, leading-zero identifiers, and assignment resolved by company/date without matching source code",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
