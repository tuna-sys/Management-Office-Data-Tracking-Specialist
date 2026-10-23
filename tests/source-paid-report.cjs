const fs = require("fs"),
  ts = require("typescript"),
  vm = require("vm"),
  assert = require("assert/strict");
const deps = {};
function load(f) {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    { module: m, exports: m.exports, Date, require: (n) => deps[n] },
  );
  return m.exports;
}
deps["@/lib/worker-validation"] = load("src/lib/worker-validation.ts");
deps["@/lib/source-format"] = load("src/lib/source-format.ts");
deps["@/lib/import-review"] = load("src/lib/import-review.ts");
const report = load("src/lib/source-paid-report.ts").sourcePaidReport;
const row = (company, card, amount, date = "04/05/2026") => ({
  row: 2,
  values: {
    "Công ty": company,
    "Số CCCD": card,
    "Họ tên": "QA",
    "Ngày PV": date,
    Tháng: "Tháng 05",
    "Thưởng lần 1": amount,
  },
});
const source = {
  id: "qa",
  type: "DS_THUONG",
  file: "QA.xlsx",
  rows: [
    row("Luxshare VT", "000000000001", "300,000 - 7 công"),
    row("Goertek", "000000000002", "500,000 - 7 công"),
    row("Luxshare VT", "000000000001", "300,000 - 7 công"),
  ],
};
let r = report(
  [source],
  [],
  [],
  new URLSearchParams({ interviewFactory: "Luxshare VT", month: "2026-05" }),
);
assert.equal(r.total, 300000);
assert.equal(r.rows.length, 1);
assert.equal(r.unlinked, 1);
assert.equal(r.skippedDuplicates, 1);
assert.equal(
  report([source], [], [], new URLSearchParams({ interviewFactory: "Goertek" }))
    .total,
  500000,
);
assert.equal(
  report([source], [], [], new URLSearchParams({ from: "2026-05-05" })).total,
  0,
);
const conflict = {
  ...source,
  rows: [
    row("Luxshare VT", "000000000001", "300,000 - 7 công"),
    row("Luxshare VT", "000000000001", "400,000 - 7 công"),
  ],
};
r = report([conflict], [], [], new URLSearchParams());
assert.equal(r.pending, 1);
assert.equal(r.total, 0);

// Regression test: numeric CCCD (missing leading zero) & Excel serial date in source.rows
// must match normalized imported BonusRecord and NOT be double-counted.
const numericExcelSource = {
  id: "excel-serial",
  type: "DS_THUONG",
  file: "DS_THUONG.xlsx",
  rows: [
    {
      row: 2,
      values: {
        "Công ty": "Fushan TV",
        "Số CCCD": 4082003651,
        "Họ tên": "Bế Văn Dũng",
        "Ngày PV": 46086,
        Tháng: "Tháng 05",
        "Mã nhân viên": "V3910413",
        "Thưởng lần 1": "500,000",
      },
    },
  ],
};
const importedBonus = [
  {
    id: "bonus-db-1",
    company: "Fushan TV",
    month: "T05.2026",
    interviewDate: "05/03/2026",
    workerCode: "V3910413",
    totalBonus: 500000,
    note: JSON.stringify({
      source: "SOURCE_EXCEL_ACTUAL_PAID",
      rewards: ["500,000", "", "", "", "", "", ""],
    }),
    worker: { idCard: "004082003651", fullName: "Bế Văn Dũng" },
  },
];
const deduped = report(
  [numericExcelSource],
  [{ idCard: "004082003651", fullName: "Bế Văn Dũng", assignments: [] }],
  importedBonus,
  new URLSearchParams(),
);
assert.equal(deduped.rows.length, 1);
assert.equal(deduped.total, 500000);

console.log(
  "PASS company/date filters with no assignment, repeated import not double counted, conflicting amounts excluded from total",
);

const splitMoney = {"Công ty":"QA", "Số CCCD":"000000000091", "Họ tên":"QA", "Ngày PV":"01/10/2026", "Tháng":"T10.2026", "Tiền thưởng L1":"2tr", "Tiền thưởng L2":"Ck - 500k - Đã chốt 16/09", "Tiền thưởng L3":"Xét 1 tháng - 2tr - 25/10", "Tên thưởng L3":"7 công", "Lý do L3":"25/10", "Tổng thưởng":999};
const expectedSplit = deps["@/lib/source-format"].sourceBonusAmounts(splitMoney).totalBonus;
assert.equal(expectedSplit,4500000);
const consistent = report([{id:"split-shorthand",type:"DS_THUONG",file:"QA.xlsx",rows:[{row:2,values:splitMoney}]}],[],[],new URLSearchParams());
assert.equal(consistent.total,expectedSplit);
assert.equal(consistent.pending,0);
console.log("PASS report/import use same parser for tr/k and embedded dates/work days; source amount never establishes payment");
const partial = { ...splitMoney, "Tiền thưởng L2":"Chờ đối chiếu", "Tiền thưởng L3":"" };
const partialResult=report([{id:"partial",type:"DS_THUONG",file:"QA.xlsx",rows:[{row:2,values:partial}]}],[],[],new URLSearchParams());
assert.equal(partialResult.total,2000000);
assert.equal(partialResult.pending,1);
assert.equal(partialResult.rows[0].counted,true);
assert.ok(partialResult.rows[0].warnings.length>0);
console.log("PASS partial unreadable reward keeps recognized amounts and a visible warning");
