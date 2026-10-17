const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
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
      require: (name) => {
        if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
        return deps[name];
      },
      Date,
      URL,
    },
  );
  return module.exports;
}

const worker = {
  id: "worker-1",
  code: "WORKER-1",
  assignments: [
    {
      id: "assignment-1",
      interviewFactory: "Canon",
      workingFactory: "Canon",
      interviewDate: "04/05/2026",
      employeeCode: "EMP-1",
    },
  ],
  bankAccounts: [{ accountNumber: "000123", bankName: "QA Bank" }],
};
const records = [];
const audits = [];
let queriedWhere;
const db = {
  worker: {
    findUnique: async () => worker,
  },
  bonusRecord: {
    findFirst: async () => null,
    findMany: async ({ where }) => {
      queriedWhere = where;
      return records;
    },
    findUnique: async ({ where }) =>
      records.find((record) => record.id === where.id) || null,
    create: async ({ data }) => {
      const record = {
        id: `bonus-${records.length + 1}`,
        status: "DRAFT",
        updatedAt: new Date("2026-10-17T12:00:00.000Z"),
        createdAt: new Date("2026-10-17T12:00:00.000Z"),
        ...data,
      };
      records.push(record);
      return record;
    },
    update: async ({ where, data }) => {
      const record = records.find((item) => item.id === where.id);
      Object.assign(record, data, {
        updatedAt: new Date("2026-10-17T13:00:00.000Z"),
      });
      return record;
    },
    count: async () => records.length,
    delete: async ({ where }) => {
      const index = records.findIndex((record) => record.id === where.id);
      return records.splice(index, 1)[0];
    },
    deleteMany: async () => {
      const count = records.length;
      records.length = 0;
      return { count };
    },
  },
  auditLog: { create: async ({ data }) => audits.push(data) },
  $transaction: async (callback) => callback(db),
};
const route = load("src/app/api/bonuses/route.ts", {
  "@/lib/auth": {
    guard: async () => null,
    identity: async () => ({ username: "QA", role: "ADMIN" }),
  },
  "@/lib/prisma": { prisma: db },
  "@/lib/payment-safety": load("src/lib/payment-safety.ts"),
  "@/lib/worker-validation": load("src/lib/worker-validation.ts"),
  "next/server": {
    NextResponse: {
      json: (body, options = {}) => ({ body, status: options.status || 200 }),
    },
  },
});

const request = (body) => ({ json: async () => body });

(async () => {
  const created = await route.POST(
    request({
      workerId: "worker-1",
      assignmentId: "assignment-1",
      company: "Canon",
      month: "T05.2026",
      interviewDate: "04/05/2026",
      policy: "Policy QA",
      workerCode: "EMP-1",
      accountNumber: "000456",
      bankName: "New Bank",
      bonus1: 100,
      bonus2: 200,
      bonus3: 0,
      bonus4: 0,
      bonus5: 0,
      bonus6: 0,
      bonus7: 0,
    }),
  );
  assert.equal(created.status, 201);
  assert.deepEqual(
    [
      created.body.data.company,
      created.body.data.month,
      created.body.data.interviewDate,
      created.body.data.policy,
      created.body.data.workerCode,
      created.body.data.accountNumber,
      created.body.data.bankName,
      created.body.data.bonus1,
      created.body.data.bonus2,
      created.body.data.totalBonus,
    ],
    [
      "Canon",
      "T05.2026",
      "04/05/2026",
      "Policy QA",
      "EMP-1",
      "000456",
      "New Bank",
      100,
      200,
      300,
    ],
  );

  const updated = await route.PATCH(
    request({
      id: "bonus-1",
      updatedAt: created.body.data.updatedAt.toISOString(),
      company: "Canon QC",
      interviewDate: "05/05/2026",
      policy: "Updated policy",
      workerCode: "EMP-2",
      accountNumber: "000789",
      bankName: "Updated Bank",
      bonus1: 500,
      bonus2: 0,
      bonus3: 0,
      bonus4: 0,
      bonus5: 0,
      bonus6: 0,
      bonus7: 0,
    }),
  );
  assert.equal(updated.status, 200);
  assert.deepEqual(
    [
      updated.body.data.company,
      updated.body.data.interviewDate,
      updated.body.data.policy,
      updated.body.data.workerCode,
      updated.body.data.accountNumber,
      updated.body.data.bankName,
      updated.body.data.bonus1,
      updated.body.data.totalBonus,
    ],
    [
      "Canon QC",
      "05/05/2026",
      "Updated policy",
      "EMP-2",
      "000789",
      "Updated Bank",
      500,
      500,
    ],
  );

  await route.GET({
    url: "http://localhost/api/bonuses?month=T05.2026&month=T06.2026&company=Canon&company=LG",
  });
  assert.equal(
    Array.from(queriedWhere.month.in).join(","),
    "T05.2026,T06.2026",
  );
  assert.equal(Array.from(queriedWhere.company.in).join(","), "Canon,LG");

  const removedOne = await route.DELETE(request({ id: "bonus-1" }));
  assert.equal(removedOne.body.deletedCount, 1);
  assert.equal(records.length, 0);
  assert.equal((await route.DELETE(request({ all: true }))).status, 400);

  records.push({ id: "bonus-2" }, { id: "bonus-3" });
  const removedAll = await route.DELETE(
    request({ all: true, confirmAll: true }),
  );
  assert.equal(removedAll.body.deletedCount, 2);
  assert.equal(records.length, 0);
  assert.equal(audits.filter((audit) => audit.action === "DELETE").length, 2);
  console.log(
    "PASS: full bonus create/edit fields, multi-month/company filters, audited single delete, and confirmed delete-all.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
