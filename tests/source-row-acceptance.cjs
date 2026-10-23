const fs = require("fs"),
  ts = require("typescript"),
  vm = require("vm"),
  assert = require("assert/strict"),
  X = require("xlsx");
const deps = { xlsx: X };
function load(f) {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      module: m,
      exports: m.exports,
      process,
      Buffer,
      Date,
      require: (n) => { if (n === '@/lib/import-recovery') return {runRecoverableImport: async (db, _meta, apply) => apply(db, deps['@/lib/import-source-store'].saveImportSource)}; if (n === '@/lib/duplicate-check') return require('./load-duplicate-check.js');
        if (!(n in deps)) throw Error(n);
        return deps[n];
      },
    },
  );
  return m.exports;
}
deps["@/lib/import-review"] = load("src/lib/import-review.ts");
deps["@/lib/worker-validation"] = load("src/lib/worker-validation.ts");
deps["@/lib/source-format"] = load("src/lib/source-format.ts");
deps["@/lib/bonus-import"] = load("src/lib/bonus-import.ts");
deps["@/lib/factory-matching"] = load("src/lib/factory-matching.ts");
deps["@/lib/worker-import"] = load("src/lib/worker-import.ts");
deps["@/lib/local-request"] = {
  guard: async () => null,
  identity: async () => ({ username: "QA" }),
};
deps["@/lib/domain"] = {
  assignmentRelations: async () => {},
  today: () => "2026-10-13",
  day: (v) => v,
};
deps["@/lib/prisma"] = {
  prisma: {
    worker: { findMany: async () => [] },
    laborStatus: { findMany: async () => [] },
    factory: { findMany: async () => [] },
    bonusRecord: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
  },
};
deps["next/server"] = {
  NextResponse: { json: (body, options) => ({ body, options }) },
};
let saved = null;
deps["@/lib/import-source-store"] = {
  saveImportSource: async (type, file, sheet, rows, warnings, errors) => {
    saved = { rows, warnings, errors };
    return "qa-source";
  },
};
deps['node:crypto'] = {default:require('node:crypto')};
const route = load("src/app/api/excel-engine/import/route.ts");
const book = X.utils.book_new();
X.utils.book_append_sheet(
  book,
  X.utils.aoa_to_sheet([
    ["Họ và tên", "Số CCCD", "Ngày PV", "Nhà máy PV"],
    ["QA", "không rõ", "sai ngày", "QA FACTORY"],
  ]),
  "DS_TONG",
);
const bytes = X.write(book, { type: "buffer", bookType: "xlsx" });
const file = {
  name: "qa.xlsx",
  size: bytes.length,
  arrayBuffer: async () => bytes,
};
const request = (commit) => ({
  formData: async () => ({
    get: (k) =>
      ({ file, confirm: commit ? "true" : "false", importType: "DS_TONG" })[k],
  }),
});
(async () => {
  let r = await route.POST(request(false));
  assert.equal(r.body.summary.readyCount, 0);
  assert.equal(r.body.summary.errorCount, 1);
  assert.ok(r.body.normalizationErrors.length);
  assert.equal(saved, null);
  r = await route.POST(request(true));
  assert.equal(r.body.sourceRowsSaved, 1);
  assert.equal(r.body.normalizedSaved, 0);
  assert.equal(saved.rows[0].raw["Số CCCD"], "không rõ");
  assert.ok(saved.errors.length);
  console.log(
    "PASS invalid identity/date retained as source with warning, preview no writes, canonical count distinct from stored source count",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
