const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const vm = require("node:vm");
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
      require: (n) => {
        if (!(n in deps)) throw new Error(`Unexpected dependency: ${n}`);
        return deps[n];
      },
      console,
      Date,
      URL,
    },
  );
  return module.exports;
}
const rules = load("src/lib/payment-safety.ts");
const workerValidation = load("src/lib/worker-validation.ts");
const server = {
  "@/lib/auth": {
    guard: async () => null,
    identity: async () => ({ username: "Tester", role: "ADMIN" }),
  },
  "next/server": {
    NextResponse: {
      json: (body, options = {}) => ({ body, status: options.status || 200 }),
    },
  },
};
(async () => {
  for (const from of ["DRAFT", "REVIEWED", "APPROVED", "LOCKED", "OTHER"])
    for (const to of ["DRAFT", "REVIEWED", "APPROVED", "LOCKED", "OTHER"]) {
      assert.equal(
        rules.canTransition(from, to),
        ((from === "DRAFT" || from === "REVIEWED") && to === "APPROVED") ||
          (from === "APPROVED" && to === "LOCKED"),
      );
    }
  for (const amount of [
    -1,
    0.5,
    NaN,
    Infinity,
    "100",
    null,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.equal(rules.validAmount(amount), false);
  assert.equal(rules.validAmount(300000), true);
  assert.equal(rules.validMonth("T12.2026"), true);
  for (const month of ["T00.2026", "T13.2026", "T1.2026", null])
    assert.equal(rules.validMonth(month), false);
  const record = {
    status: "APPROVED",
    bonus1: 300000,
    totalBonus: 300000,
    approvedBy: "Tester",
    approvedAt: new Date(),
    worker: {
      bankAccounts: [{ verificationStatus: "VALID", isNameVerified: true }],
    },
  };
  assert.ok(
    rules.paymentIssue(record),
    "Legacy VALID must not authorize payment",
  );
  assert.ok(rules.paymentIssue({ ...record, status: "DRAFT" }));
  assert.ok(rules.paymentIssue({ ...record, worker: { bankAccounts: [] } }));
  assert.ok(
    rules.paymentIssue({ ...record, worker: { bankAccounts: [{}, {}] } }),
  );
  const verify = load("src/app/api/bank-accounts/verify/route.ts", server);
  assert.equal(
    (
      await verify.POST({
        json: async () => ({ bankName: "Test", accountNumber: "123456" }),
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await verify.POST({
        json: async () => ({ bankName: "Test", accountNumber: "bad" }),
      })
    ).status,
    400,
  );
  let current = { ...record, id: "test", updatedAt: new Date() };
  let auditFailure = false;
  let race = false;
  const mock = {
    $transaction: async (fn) =>
      fn({
        bonusRecord: {
          findUnique: async () => current,
          updateMany: async () => ({ count: race ? 0 : 1 }),
        },
        auditLog: {
          create: async () => {
            if (auditFailure) throw new Error("Mock audit failure");
          },
        },
      }),
  };
  const bonuses = load("src/app/api/bonuses/route.ts", {
    ...server,
    "@/lib/prisma": { prisma: mock },
    "@/lib/payment-safety": rules,
    "@/lib/worker-validation": workerValidation,
  });
  const put = (data) => bonuses.PUT({ json: async () => data });
  assert.equal((await put({ id: "test", status: "UNKNOWN" })).status, 400);
  current.status = "LOCKED";
  assert.equal(
    (await put({ id: "test", status: "APPROVED", approver: "Tester" })).status,
    409,
  );
  current.status = "DRAFT";
  assert.equal(
    (await put({ id: "test", status: "LOCKED", approver: "Tester" })).status,
    409,
  );
  assert.equal(
    (await put({ id: "test", status: "APPROVED", approver: "Tester" })).status,
    200,
  );
  race = true;
  assert.equal(
    (await put({ id: "test", status: "APPROVED", approver: "Tester" })).status,
    409,
  );
  race = false;
  auditFailure = true;
  assert.equal(
    (await put({ id: "test", status: "APPROVED", approver: "Tester" })).status,
    500,
  );
  let excelWritten = false;
  const exportRoute = load("src/app/api/excel-engine/export/route.ts", {
    ...server,
    "@/lib/prisma": {
      prisma: { bonusRecord: { findMany: async () => [record] } },
    },
    "@/lib/payment-safety": rules,
    xlsx: {
      write: () => {
        excelWritten = true;
        throw new Error("Must not export");
      },
    },
  });
  assert.equal(
    (
      await exportRoute.GET({
        url: "http://localhost/api?type=PAYMENT_BATCH&month=T01.2026",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await exportRoute.GET({
        url: "http://localhost/api?type=PAYMENT_BATCH&month=T13.2026",
      })
    ).status,
    400,
  );
  assert.equal(excelWritten, false);
  const validation = load("src/lib/worker-validation.ts");
  assert.equal(validation.cleanFields({ dob: null }, ["dob"]).dob, "");
  assert.equal(validation.dateKey("31/02/2026"), null);
  assert.equal(validation.dateKey("29/02/2024"), "2024-02-29");
  assert.equal(validation.phoneKey("+84 900 000 001"), "0900000001");
  assert.throws(() =>
    validation.validateWorker(
      { fullName: "Test", idCard: "000000000001" },
      {
        interviewFactory: "Test",
        status: "Đã nghỉ việc",
        interviewDate: "10/10/2026",
        leaveDate: "09/10/2026",
        leaveReason: "Test",
      },
    ),
  );
  const parser = load("src/lib/worker-import.ts", {
    xlsx: require("xlsx"),
    "@/lib/worker-validation": validation,
    "@/lib/source-format": load("src/lib/source-format.ts", {
      "@/lib/worker-validation": validation,
    }),
  });
  assert.throws(() =>
    parser.parseImportRow({
      "Họ và tên": "Test",
      "số CCCD": 123456789,
      "Nhà máy PV": "Test",
    }),
  );
  const imported = parser.parseImportRow({
    "Họ và tên ": "Test",
    "số CCCD": "000000000001",
    SĐT: "0900000001",
    "Nhà máy PV": "Test",
    "Ngày PV": 46307,
  });
  assert.equal(imported.worker.idCard, "000000000001");
  assert.ok(validation.dateKey(imported.assignment.interviewDate));
  console.log(
    "PASS: transition matrix, amount/month validation, bank verification, locked/racing approvals, audit failure, blocked payment export. No real database used.",
  );
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
