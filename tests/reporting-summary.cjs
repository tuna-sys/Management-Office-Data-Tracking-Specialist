const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ts = require("typescript"),
  vm = require("node:vm");
function loadProvince() {
  const value = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/province-name.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: value, exports: value.exports });
  return value.exports;
}
const m = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/lib/reporting.ts", "utf8"), {
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
    require: (name) =>
      name === "@/lib/province-name" ? loadProvince() : name === "@/lib/domain"
        ? { monthOf: (v) => (v ? v.slice(0, 7) : ""), today: () => "" }
        : { dateKey: (v) => v || null },
  },
);
const a = {
  id: "a",
  workerId: "w",
  interviewDate: "2026-10-01",
  interviewFactory: "A",
  status: "Đang làm việc",
  interviewResult: "PASS",
};
const w = { id: "w", assignments: [a] };
a.worker = w;
const r = m.exports.recruitmentReport([w], new URLSearchParams());
assert.equal(r.orders[0].statusCounts["Đang làm việc"], 1);
assert.equal(r.summary.passRate, 100);
const e = {
  factory: "A",
  policyName: "Tiền xe",
  assignment: a,
  stages: [
    {
      label: "Tiền xe",
      thresholdDays: 15,
      amount: 300000,
      eligible: true,
      achieved: true,
      payments: [{ amount: 100000 }],
    },
    {
      label: "Thưởng",
      thresholdDays: 3,
      amount: 50000,
      eligible: false,
      achieved: false,
      payments: [],
    },
  ],
};
const b = m.exports.rewardReport([e], new URLSearchParams());
assert.equal(b.milestones[0].name, "A · Tiền xe · 15 công");
assert.equal(b.milestones[0].earned, 300000);
assert.equal(b.milestones[0].paid, 100000);
assert.equal(b.milestones[0].outstanding, 200000);
assert.equal(b.milestones[0].achieveRate, 100);
assert.equal(b.milestones[1].achieveRate, null);
assert.equal(b.stages[0].earned, 300000);
console.log(
  "PASS: order statuses, configured work-day milestones, partial payments, rates with missing denominator.",
);
