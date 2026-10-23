const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
function load(file, deps = {}, cache = {}) {
  if (cache[file]) return cache[file];
  const m = { exports: {} };
  cache[file] = m.exports;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { module: m, exports: m.exports, require: name => name in deps ? deps[name]
    : name.startsWith("@/") ? load("src/" + name.slice(2) + ".ts", deps, cache) : require(name),
    process, Buffer, URL, URLSearchParams, Date, Map, Set });
  return cache[file] = m.exports;
}
const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
const local = { guard: async () => null, identity: async () => ({ username: "QA" }) };
const date = new Date("2026-10-01T00:00:00Z");
function enrollmentRoute(bonuses = [], enrollments = []) {
  return load("src/app/api/enrollments/route.ts", { "next/server": next,
    "@/lib/local-request": local, "@/lib/read-data-version": { readDataVersion: async () => "fixture" }, "@/lib/prisma": { prisma: {
      policyEnrollment: { findMany: async () => enrollments }, bonusRecord: { findMany: async () => bonuses },
    } } });
}
const bonus = { id: "bonus", workerId: "worker", assignmentId: null, worker: { id: "worker", fullName: "QA", idCard: "000000000001" },
  month: "T10.2026", company: "QA", interviewDate: "2026-10-01", bonus1: 500000, note: null, status: "DRAFT", createdAt: date, updatedAt: date };
const get = (route, params = {}) => route.GET({ nextUrl: { searchParams: new URLSearchParams(params) } });
test("manual draft bonus is not a paid Excel enrollment", async () => {
  const result = await get(enrollmentRoute([bonus]));
  assert.equal(result.body.data.length, 0);
});
test("paid Excel source retains amount without invented voucher or payment day", async () => {
  const result = await get(enrollmentRoute([{ ...bonus, note: JSON.stringify({ source: "SOURCE_EXCEL_ACTUAL_PAID" }) }]));
  const payment = result.body.data[0].stages[0].payments[0];
  assert.equal(payment.amount, 500000);
  assert.equal(payment.reference, null);
  assert.equal(payment.paidOn, null);
  assert.equal(payment.isSourceExcel, true);
});
test("month filter accepts UI month format for a real enrollment", async () => {
  const entry = { id: "enrollment", assignmentId: "assignment", stages: [], assignment: {
    worker: bonus.worker, interviewDate: "2026-10-01", onboardingMonth: null } };
  const route = enrollmentRoute([], [entry]);
  assert.equal((await get(route, { month: "T10.2026" })).body.data.length, 1);
  assert.equal((await get(route, { month: "T11.2026" })).body.data.length, 0);
});
function deletionRoute({ owner = "worker", financial = false, enrollment = false, active = false, assignments = true } = {}) {
  const writes = [];
  const worker = { id: "worker", assignments: assignments ? [{ id: "assignment", workerId: "worker", status: active ? "Đang làm việc" : "Đã nghỉ việc" }] : [] };
  const tx = { worker: { findUnique: async () => worker, delete: async () => writes.push("worker") },
    workAssignment: { findUnique: async () => ({ id: "assignment", workerId: owner, status: active ? "Đang làm việc" : "Đã nghỉ việc" }),
      count: async () => 0, delete: async () => writes.push("assignment") },
    bonusRecord: { count: async () => financial ? 1 : 0, deleteMany: async () => writes.push("bonus") },
    policyEnrollment: { count: async () => enrollment ? 1 : 0 },
    laborStatus: { findUnique: async () => ({ endsAssignment: !active }) },
    assignmentEvent: { deleteMany: async () => writes.push("events") },
    bankAccount: { deleteMany: async () => writes.push("bank") }, auditLog: { create: async () => {} } };
  return { writes, route: load("src/app/api/workers/route.ts", { "next/server": next, "@/lib/local-request": local,
    "@/lib/import-source-store": {}, "@/lib/reporting": {}, "@/lib/prisma": { prisma: { ...tx, $transaction: async fn => fn(tx) } } }) };
}
test("deleting a mismatched worker and assignment rejects without writes", async () => {
  const { route, writes } = deletionRoute({ owner: "different-worker" });
  assert.equal((await route.DELETE({ json: async () => ({ workerId: "worker", assignmentId: "assignment" }) })).status, 409);
  assert.equal(writes.length, 0);
});
test("deleting financial history rejects without writes", async () => {
  const { route, writes } = deletionRoute({ financial: true });
  assert.equal((await route.DELETE({ json: async () => ({ workerId: "worker", assignmentId: "assignment" }) })).status, 409);
  assert.equal(writes.length, 0);
});
test("deleting active assignment rejects without writes", async () => {
  const { route, writes } = deletionRoute({ active: true });
  assert.equal((await route.DELETE({ json: async () => ({ workerId: "worker", assignmentId: "assignment" }) })).status, 409);
  assert.equal(writes.length, 0);
});
test("deleting without a target does not claim success", async () => {
  const { route, writes } = deletionRoute();
  assert.equal((await route.DELETE({ json: async () => ({}) })).status, 400);
  assert.equal(writes.length, 0);
});
test("explicit ended assignment without financial history can be deleted", async () => {
  const { route, writes } = deletionRoute();
  assert.equal((await route.DELETE({ json: async () => ({ workerId: "worker", assignmentId: "assignment" }) })).status, 200);
  assert.ok(writes.includes("assignment"));
});
test("archiving retains paid source and legacy imported history", () => {
  const report = load("src/lib/source-paid-report.ts").sourcePaidReport;
  const worker = { ...bonus.worker, assignments: [], archivedAt: date };
  const source = { id: "source", type: "DS_THUONG", rows: [{ row: 2, values: {
    "Số CCCD": worker.idCard, "Công ty": "QA", "Ngày PV": "01/10/2026", "Thưởng lần 1": 500000 } }] };
  assert.equal(report([source], [worker], [], new URLSearchParams()).total, 500000);
  const imported = { ...bonus, worker, totalBonus: 500000, note: JSON.stringify({ source: "SOURCE_EXCEL_ACTUAL_PAID" }) };
  assert.equal(report([], [worker], [imported], new URLSearchParams()).total, 500000);
});

test("pagination caps details and preserves totals across all filtered rows", async () => {
  const records = Array.from({ length: 25 }, (_, i) => ({ ...bonus, id: "bonus-" + i,
    note: JSON.stringify({ source: "SOURCE_EXCEL_ACTUAL_PAID" }) }));
  const result = await get(enrollmentRoute(records), { page: "2", pageSize: "10" });
  assert.equal(result.body.data.length, 10);
  assert.equal(result.body.data[0].id, "bonus-10");
  assert.equal(result.body.filteredTotal, 25);
  assert.equal(result.body.summary.totalPaidMoney, 12500000);
  assert.equal(result.body.summary.totalRemainingMoney, 0);
  const last = await get(enrollmentRoute(records), { page: "999", pageSize: "10" });
  assert.equal(last.body.page, 3);
  assert.equal(last.body.data.length, 5);
});
test("unfiltered legacy reads retain all rows and normal payments retain true vouchers", async () => {
  const entry = { id: "real", assignmentId: "a", stages: [{ amount: 1000000, achieved: true,
    payments: [{ amount: 200000, paidOn: "2026-10-02", reference: "REAL-001" }] }],
    assignment: { worker: bonus.worker, interviewDate: "2026-10-01" } };
  const result = await get(enrollmentRoute([], [entry]));
  assert.equal(result.body.data[0].stages[0].payments[0].reference, "REAL-001");
  assert.equal(result.body.summary.totalRemainingMoney, 800000);
});

test("repeated pages reuse a versioned snapshot and refresh on data changes", async () => {
  let reads = 0, version = "one";
  const route = load("src/app/api/enrollments/route.ts", { "next/server": next, "@/lib/local-request": local,
    "@/lib/read-data-version": { readDataVersion: async () => version },
    "@/lib/prisma": { prisma: { policyEnrollment: { findMany: async () => [] },
      bonusRecord: { findMany: async () => { reads++; return [{ ...bonus, note: JSON.stringify({ source: "SOURCE_EXCEL_ACTUAL_PAID" }) }]; } } } } });
  await get(route, { page: "1", pageSize: "10" });
  await get(route, { page: "2", pageSize: "10" });
  assert.equal(reads, 1);
  version = "two";
  await get(route, { page: "1", pageSize: "10" });
  assert.equal(reads, 2);
});

test("enrollment and its payment history prevent cascading deletion", async () => {
  const { route, writes } = deletionRoute({ enrollment: true });
  assert.equal((await route.DELETE({ json: async () => ({ workerId: "worker", assignmentId: "assignment" }) })).status, 409);
  assert.equal(writes.length, 0);
});
test("worker-only deletion never silently chooses a recruitment history", async () => {
  const { route, writes } = deletionRoute();
  assert.equal((await route.DELETE({ json: async () => ({ workerId: "worker" }) })).status, 409);
  assert.equal(writes.length, 0);
});
