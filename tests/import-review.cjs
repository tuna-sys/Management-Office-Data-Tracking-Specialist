const fs = require("fs"),
  ts = require("typescript"),
  vm = require("vm"),
  assert = require("assert/strict");
const deps = {"node:fs":{existsSync:()=>false}, "node:path": require("node:path")};
function load(f) {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020, esModuleInterop: true,
      },
    }).outputText,
    { module: m, exports: m.exports, Date, require: (n) => deps[n] },
  );
  return m.exports;
}
deps["@/lib/factory-matching"] = load("src/lib/factory-matching.ts");
deps["@/lib/import-review"] = load("src/lib/import-review.ts");
deps["@/lib/worker-validation"] = load("src/lib/worker-validation.ts");
deps["@/lib/source-format"] = load("src/lib/source-format.ts");
deps["@/lib/worker-source-view"] = load("src/lib/worker-source-view.ts");
const split = deps["@/lib/import-review"].splitImportReview;
const review = split([
  "Dòng 2: SĐT không hợp lệ",
  "Dòng 2: SĐT không hợp lệ",
  "Dòng 3: lượt PV đã có, không ghi đè",
  "Dòng 3: ngày cần kiểm tra",
  "Dòng 4: STK trùng hồ sơ đã có",
]);
assert.equal(review.warningRows, 1);
assert.equal(review.duplicateRows, 2);
assert.equal(review.reviewRows, 3);
assert.equal(review.duplicates[1].kind, "BANK_ACCOUNT");
const sources = [
  {
    id: "qa",
    type: "DS_TONG",
    file: "QA.xlsx",
    sheet: "DS_TONG",
    rows: [
      {
        row: 2,
        values: {
          "Số CCCD": "000000000001",
          "Nhà máy PV": "QA",
          "Ngày PV": "04/05/2026",
        },
        warnings: ["Dòng 2: SĐT không hợp lệ"],
        duplicates: [],
      },
      {
        row: 3,
        values: {
          "Số CCCD": "000000000001",
          "Nhà máy PV": "QA",
          "Ngày PV": "04/05/2026",
        },
        warnings: ["Dòng 3: ngày cần kiểm tra"],
        duplicates: ["Dòng 3: lượt PV đã có, không ghi đè"],
      },
    ],
  },
];
deps["@/lib/auth"] = { guard: async () => null };
deps["@/lib/import-source-store"] = { readImportSources: async () => sources };
deps["@/lib/prisma"] = { prisma: { worker: { findMany: async () => [] }, auditLog: { findMany: async () => [] } } };
deps["next/server"] = {
  NextResponse: { json: (body, options) => ({ body, ...options }) },
};
(async () => {
  const main = await load("src/app/api/worker-source-rows/route.ts").GET({
    nextUrl: { searchParams: new URLSearchParams() },
  });
  assert.equal(main.body.data.length, 1);
  assert.equal(main.body.data[0].sourceRow, 2);
  assert.equal(main.body.pendingDuplicateCount, 1);
  const lists = await load("src/app/api/import-review/route.ts").GET({});
  assert.equal(lists.body.data.warnings.length, 1);
  assert.equal(lists.body.data.duplicates.length, 1);
  assert.equal(lists.body.data.duplicates[0].issues.length, 2);
  console.log(
    "PASS distinct row counts, warnings stay in main list, duplicates isolated, combined warning retained on duplicate review row",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
