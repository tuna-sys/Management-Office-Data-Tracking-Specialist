const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function load(file, deps = {}) {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      module: m,
      exports: m.exports,
      Date,
      URLSearchParams,
      parseInt,
      Math,
      require: (n) => {
        if (n === "@/lib/read-cache") return { cachedRead: async (_key, _version, read) => read() };
        if (n === "@/lib/read-data-version") return { readDataVersion: async () => "fixture" };
        if (n === "@/lib/duplicate-check") {
          try {
            return require("./load-duplicate-check.js");
          } catch {
            return {
              assertDailyInterview: () => {},
              identityText: (s) => (s || "").trim().toLowerCase(),
            };
          }
        }
        if (n === "@/lib/province-name") return { provinceName: () => "" };
        if (n === "@/lib/reporting") {
          return {
            matchesAssignment: (a, p) => {
              const fac = p.get("factory");
              if (fac && a.interviewFactory !== fac) return false;
              const st = p.get("status");
              if (st && a.status !== st) return false;
              return true;
            },
          };
        }
        if (n === "@/lib/domain") {
          return {
            DomainError: class DomainError extends Error {},
            text: (s) => s || "",
            assignmentRelations: async () => {},
            assignmentEnded: async () => false,
            resultError: (e) => ({
              status: e.status || 500,
              body: { success: false, message: e.message },
            }),
            today: () => "2026-10-29",
            warnsWorker: () => [],
          };
        }
        if (n === "@/lib/worker-validation") {
          return {
            WORKER_FIELDS: ["fullName", "idCard"],
            ASSIGNMENT_FIELDS: ["interviewFactory", "status"],
            cleanFields: (b, f) => b,
            validateWorker: () => {},
            validateInterview: () => {},
            phoneKey: (p) => p,
            dateKey: (d) => d,
          };
        }
        if (n === "@/lib/import-source-store") {
          return {
            readImportSources: async () => [],
            resolveImportSourceRow: async () => null,
          };
        }
        if (!(n in deps)) throw Error(`Unexpected dependency ${n}`);
        return deps[n];
      },
    },
  );
  return m.exports;
}

const server = {
  NextResponse: {
    json: (body, options = {}) => ({ body, status: options.status || 200 }),
  },
};

const mockWorkers = [
  {
    id: "w1",
    fullName: "NGUYỄN VĂN A",
    idCard: "001099000001",
    code: "NV001",
    phone: "0900000001",
    recruiter: "REC1",
    archivedAt: null,
    createdAt: new Date("2026-01-01"),
    assignments: [
      {
        id: "a1",
        interviewFactory: "ALPHA",
        interviewDate: "15/06/2026",
        employeeCode: "EMP01",
        status: "Đang làm việc",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ],
    bankAccounts: [
      {
        id: "b1",
        bankName: "Vietcombank",
        bankCode: "VCB",
        accountNumber: "123456789",
        accountHolderName: "NGUYEN VAN A",
        createdAt: new Date("2026-01-01"),
      },
    ],
  },
  {
    id: "w2",
    fullName: "TRẦN THỊ B",
    idCard: "001099000002",
    code: "NV002",
    phone: "0900000002",
    recruiter: "REC2",
    archivedAt: null,
    createdAt: new Date("2026-01-02"),
    assignments: [], // Người CHƯA có lượt tuyển
    bankAccounts: [
      {
        id: "b2",
        bankName: "MBBank",
        bankCode: "MB",
        accountNumber: "987654321",
        accountHolderName: "TRAN THI B",
        createdAt: new Date("2026-01-02"),
      },
    ],
  },
  {
    id: "w3",
    fullName: "LÊ VĂN C",
    idCard: "001099000003",
    code: "NV003",
    phone: "0900000003",
    recruiter: "REC1",
    archivedAt: null,
    createdAt: new Date("2026-01-03"),
    assignments: [
      {
        id: "a3",
        interviewFactory: "BETA",
        interviewDate: "20/06/2026",
        employeeCode: "EMP03",
        status: "Đang chờ phỏng vấn",
        createdAt: new Date("2026-01-03"),
        updatedAt: new Date("2026-01-03"),
      },
    ],
    bankAccounts: [],
  },
];

function createMockPrisma() {
  return {
    worker: {
      findMany: async (args = {}) => {
        let list = [...mockWorkers];
        if (args.where?.search || args.where?.OR) {
          const kw = args.where.OR?.[0]?.fullName?.contains || "";
          if (kw) {
            list = list.filter((w) =>
              w.fullName.includes(kw) ||
              w.idCard.includes(kw) ||
              w.phone?.includes(kw) ||
              w.code?.includes(kw),
            );
          }
        }
        if (args.select) {
          list = list.map((w) => {
            const row = {};
            for (const k of Object.keys(args.select)) {
              if (args.select[k]) row[k] = w[k];
            }
            return row;
          });
        }
        if (args.include) {
          list = list.map((w) => {
            const item = { ...w };
            if (!args.include.bankAccounts) delete item.bankAccounts;
            return item;
          });
        }
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list;
      },
      count: async (args = {}) => {
        let list = [...mockWorkers];
        if (args.where?.OR) {
          const kw = args.where.OR?.[0]?.fullName?.contains || "";
          if (kw) {
            list = list.filter((w) =>
              w.fullName.includes(kw) ||
              w.idCard.includes(kw) ||
              w.phone?.includes(kw) ||
              w.code?.includes(kw),
            );
          }
        }
        return list.length;
      },
      findUnique: async (args = {}) => {
        const found = mockWorkers.find((w) => w.id === args.where?.id);
        if (!found) return null;
        if (args.select) {
          const res = {};
          if (args.select.id) res.id = found.id;
          if (args.select.fullName) res.fullName = found.fullName;
          if (args.select.idCard) res.idCard = found.idCard;
          if (args.select.code) res.code = found.code;
          if (args.select.phone) res.phone = found.phone;
          if (args.select.assignments) res.assignments = found.assignments;
          if (args.select.bankAccounts) res.bankAccounts = found.bankAccounts;
          return res;
        }
        return found;
      },
    },
  };
}

test("GET /api/workers?view=lookup: trả về trường tinh gọn và hỗ trợ người chưa có lượt tuyển", async () => {
  const prisma = createMockPrisma();
  const route = load("src/app/api/workers/route.ts", {
    "next/server": server,
    "@/lib/local-request": { guard: async () => null },
    "@/lib/prisma": { prisma },
  });

  const res = await route.GET({
    nextUrl: { searchParams: new URLSearchParams("view=lookup&page=1&pageSize=10") },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 3);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 10);
  assert.equal(res.body.totalPages, 1);

  // Người w2 chưa có lượt tuyển vẫn nằm trong lookup
  const w2 = res.body.data.find((w) => w.id === "w2");
  assert.ok(w2, "Người chưa có lượt tuyển phải hiển thị trong lookup");
  assert.equal(w2.fullName, "TRẦN THỊ B");

  // Chỉ chứa các trường lookup tinh gọn
  for (const item of res.body.data) {
    assert.ok(item.id);
    assert.ok(item.fullName);
    assert.ok(item.idCard);
    assert.equal(item.assignments, undefined, "Lookup không được chứa assignments");
    assert.equal(item.bankAccounts, undefined, "Lookup không được chứa bankAccounts");
  }
});

test("GET /api/workers?view=lookup&search=...: tìm kiếm theo từ khóa", async () => {
  const prisma = createMockPrisma();
  const route = load("src/app/api/workers/route.ts", {
    "next/server": server,
    "@/lib/local-request": { guard: async () => null },
    "@/lib/prisma": { prisma },
  });

  const res = await route.GET({
    nextUrl: { searchParams: new URLSearchParams("view=lookup&search=TRẦN") },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].id, "w2");
});

test("GET /api/workers: chế độ mặc định bỏ bankAccounts và loại người 0 lượt tuyển", async () => {
  const prisma = createMockPrisma();
  const route = load("src/app/api/workers/route.ts", {
    "next/server": server,
    "@/lib/local-request": { guard: async () => null },
    "@/lib/prisma": { prisma },
  });

  const res = await route.GET({
    nextUrl: { searchParams: new URLSearchParams("") },
  });

  assert.equal(res.status, 200);
  // w2 có 0 assignments nên filter loại bỏ, chỉ còn w1 và w3
  assert.equal(res.body.data.length, 2);
  assert.ok(res.body.data.every((w) => w.id !== "w2"));

  // Mặc định không nạp bankAccounts
  for (const w of res.body.data) {
    assert.equal(w.bankAccounts, undefined, "Mặc định không được nạp bankAccounts");
    assert.ok(Array.isArray(w.assignments), "assignments phải được nạp");
  }

  // Khi có include=bankAccounts thì nạp
  const resWithBanks = await route.GET({
    nextUrl: { searchParams: new URLSearchParams("include=bankAccounts") },
  });
  assert.ok(resWithBanks.body.data[0].bankAccounts !== undefined);
});

test("GET /api/workers/[id]: trả về thông tin chi tiết đầy đủ của 1 người", async () => {
  const prisma = createMockPrisma();
  const route = load("src/app/api/workers/[id]/route.ts", {
    "next/server": server,
    "@/lib/local-request": { guard: async () => null, identity: async () => ({ username: "QA" }) },
    "@/lib/prisma": { prisma },
  });

  // 1. Worker w1 có cả assignments và bankAccounts
  const res1 = await route.GET(
    {},
    { params: { id: "w1" } },
  );
  assert.equal(res1.status, 200);
  assert.equal(res1.body.success, true);
  assert.equal(res1.body.data.id, "w1");
  assert.equal(res1.body.data.fullName, "NGUYỄN VĂN A");
  assert.equal(res1.body.data.assignments.length, 1);
  assert.equal(res1.body.data.assignments[0].interviewFactory, "ALPHA");
  assert.equal(res1.body.data.bankAccounts.length, 1);
  assert.equal(res1.body.data.bankAccounts[0].bankCode, "VCB");
  assert.equal(res1.body.data.bankAccounts[0].isDefault, undefined, "BankAccount không có trường isDefault");

  // 2. Worker w2 CHƯA có lượt tuyển -> assignments là mảng rỗng
  const res2 = await route.GET(
    {},
    { params: { id: "w2" } },
  );
  assert.equal(res2.status, 200);
  assert.equal(res2.body.data.assignments.length, 0, "Người chưa có lượt tuyển phải có assignments rỗng");
  assert.equal(res2.body.data.bankAccounts.length, 1);

  // 3. Worker không tồn tại -> 404
  const res404 = await route.GET(
    {},
    { params: { id: "non-existent" } },
  );
  assert.equal(res404.status, 404);
  assert.equal(res404.body.success, false);
});

test("GET /api/workers/[id]: bị chặn khi guard() từ chối", async () => {
  const prisma = createMockPrisma();
  const route = load("src/app/api/workers/[id]/route.ts", {
    "next/server": server,
    "@/lib/local-request": {
      guard: async () => ({ status: 401, body: { success: false, message: "Unauthorized" } }),
      identity: async () => null,
    },
    "@/lib/prisma": { prisma },
  });

  const res = await route.GET({}, { params: { id: "w1" } });
  assert.equal(res.status, 401);
});
