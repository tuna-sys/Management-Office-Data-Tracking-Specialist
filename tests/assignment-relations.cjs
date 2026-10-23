const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function load(file, deps = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module: loaded,
      exports: loaded.exports,
      require: (name) => {
        if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
        return deps[name];
      },
    },
  );
  return loaded.exports;
}

const workerValidation = load("src/lib/worker-validation.ts");
const duplicateCheck = require("./load-duplicate-check.js");
const nextServer = { NextResponse: { json: (body, init) => ({ body, init }) } };
const domain = load("src/lib/domain.ts", {
  "@/lib/duplicate-check": duplicateCheck,
  "@/lib/worker-validation": workerValidation,
  "next/server": nextServer,
});

const { assignmentRelations } = domain;
const factory = { id: "factory-1", name: "Nhà máy A", isActive: true };
const status = { id: "status-1", name: "Đang làm việc", isActive: true };
const team = { id: "team-1", name: "Team A", isActive: true };
const recruiter = { id: "recruiter-1", name: "Chuyên viên A", teamId: team.id, team, isActive: true };
const tx = (order = null, batch = null) => ({
  factory: { findMany: async () => [factory], findUnique: async ({ where }) => where.id === factory.id ? factory : null },
  laborStatus: { findUnique: async ({ where }) => where.id ? (where.id === status.id ? status : null) : (where.name === status.name ? status : null) },
  recruiter: { findMany: async () => [recruiter], findUnique: async ({ where }) => where.id === recruiter.id ? recruiter : null },
  recruitmentTeam: { findMany: async () => [team], findUnique: async ({ where }) => where.id === team.id ? team : null },
  recruitmentOrder: { findUnique: async ({ where }) => where.id === order?.id ? order : null },
  recruitmentBatch: { findUnique: async ({ where }) => where.id === batch?.id ? batch : null },
});

(async () => {
  const value = { interviewFactory: "nhà máy a", status: status.name, recruiter: recruiter.name, interviewDate: "2026-10-10" };
  await assignmentRelations(tx(), value);
  assert.equal(value.interviewFactoryId, factory.id);
  assert.equal(value.interviewFactory, factory.name);
  assert.equal(value.statusId, status.id);
  assert.equal(value.recruiterId, recruiter.id);
  assert.equal(value.teamId, team.id);
  assert.equal(value.team, team.name);

  const mismatch = { interviewFactoryId: factory.id, interviewFactory: factory.name, statusId: status.id, status: "Đã nghỉ việc" };
  await assert.rejects(() => assignmentRelations(tx(), mismatch), /không khớp danh mục/);

  const order = { id: "order-1", factoryId: "other-factory", factory: "Nhà máy khác", isActive: true };
  const wrongFactory = { interviewFactoryId: factory.id, interviewFactory: factory.name, status: status.name, orderId: order.id };
  await assert.rejects(() => assignmentRelations(tx(order), wrongFactory), /không khớp đơn hàng/);

  const batch = { id: "batch-1", orderId: "different-order", startDate: "2026-10-01", endDate: "2026-10-31" };
  const wrongBatch = { interviewFactoryId: factory.id, interviewFactory: factory.name, status: status.name, orderId: "order-1", batchId: batch.id, interviewDate: "2026-10-10" };
  await assert.rejects(() => assignmentRelations(tx({ id: "order-1", factoryId: factory.id, factory: factory.name, isActive: true }, batch), wrongBatch), /không thuộc đơn hàng/);

  const optionalWorking = { interviewFactoryId: factory.id, interviewFactory: factory.name, workingFactory: "Nhà máy làm việc ghi tự do", status: status.name };
  await assignmentRelations(tx(), optionalWorking);
  assert.equal(optionalWorking.workingFactory, "Nhà máy làm việc ghi tự do");
  assert.equal(optionalWorking.workingFactoryId, null);
  const sourceFactory = { interviewFactory: "Nhà máy PV ngoài danh mục", status: status.name };
  await assignmentRelations(tx(), sourceFactory);
  assert.equal(sourceFactory.interviewFactory, "Nhà máy PV ngoài danh mục");
  assert.equal(sourceFactory.interviewFactoryId, null);
  assert.equal(sourceFactory.workingFactory, null);
  console.log("PASS relation resolver maps catalog IDs and rejects status, factory/order, and batch/order mismatches");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
