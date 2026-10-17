const fs = require("fs"),
  ts = require("typescript"),
  vm = require("vm"),
  assert = require("assert/strict"),
  X = require("xlsx");
const deps = {};
function load(file) {
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
      require: (n) => (n === "xlsx" ? X : deps[n]),
    },
  );
  return m.exports;
}
deps["@/lib/worker-validation"] = load("src/lib/worker-validation.ts");
deps["@/lib/source-format"] = load("src/lib/source-format.ts");
const parser = load("src/lib/worker-import.ts");
const raw = {
  "Nhà máy PV": "A",
  "Nhà \r\nmáy làm việc": "B",
  "Loại HĐ": "CTV",
  "Tình trạng": "NH",
  "Ngày NH": "không rõ",
  "Lý do": "Nguồn để trống",
  "Họ và tên": "QA",
  "Số CCCD": "000000000001",
  SĐT: "không rõ",
  "Ngày PV": "04/05/2026",
  "Tháng nhận việc": "Tháng 05",
};
const result = parser.parseImportRow(raw, true);
assert.equal(result.assignment.workingFactory, "B");
assert.equal(result.assignment.contractType, "CTV");
assert.equal(result.assignment.leaveDate, "không rõ");
assert.equal(result.worker.phone, "khôngrõ");
const trainingColumns = parser.parseImportRow(
  {
    "Nhà máy PV": "A",
    "Họ và tên": "QA",
    "Số CCCD": "000000000001",
    "Đón xe + KTX": "Có xe, ở KTX",
    "TÌNH TRẠNG ĐÀO TẠO": "Đã hoàn thành",
  },
  true,
);
assert.equal(trainingColumns.assignment.shuttleBusKtx, "Có xe, ở KTX");
assert.equal(trainingColumns.assignment.expectedTrainingStatus, "Đã hoàn thành");
const workbookHeaders = parser.parseImportRow(
  {
    "Nhà máy PV": "A",
    "Họ và tên": "QA",
    "Số CCCD": "000000000001",
    "Đón xe - KTX": 0,
    "Tình trạng Đào tạo dự kiến": "OK",
  },
  true,
);
assert.equal(workbookHeaders.assignment.shuttleBusKtx, "0");
assert.equal(workbookHeaders.assignment.expectedTrainingStatus, "OK");
const mappedTrainingLabel = parser.parseImportRow(
  {
    "Nhà máy PV": "A",
    "Họ và tên": "QA",
    "Số CCCD": "000000000001",
    "TT ĐT dự kiến": "OK",
  },
  true,
);
assert.equal(mappedTrainingLabel.assignment.expectedTrainingStatus, "OK");
assert.throws(() => parser.parseImportRow(raw));
deps["@/lib/worker-source-view"] = load("src/lib/worker-source-view.ts");
const normalizedSource = deps["@/lib/worker-source-view"].normalizeWorkerSourceValues({
  "Đón xe - KTX": 0,
  "Tình trạng Đào tạo dự kiến": "OK",
});
assert.equal(normalizedSource["Đón xe + KTX"], 0);
assert.equal(normalizedSource["Tình trạng đào tạo"], "OK");
const view = deps["@/lib/worker-source-view"].workerSourceView(
  { phone: "changed" },
  {
    events: [
      {
        note:
          "Import Excel — source:" +
          JSON.stringify({
            values: {
              ...raw,
              "Đón xe - KTX": 0,
              "Tình trạng Đào tạo dự kiến": "OK",
            },
            warnings: ["SĐT cần kiểm tra"],
          }),
      },
    ],
  },
);
assert.equal(view.values["SĐT"], "không rõ");
assert.equal(view.values["Nhà máy làm việc"], "B");
assert.equal(view.values["Đón xe + KTX"], 0);
assert.equal(view.values["Tình trạng đào tạo"], "OK");
assert.equal(view.warnings.length, 1);
console.log(
  "PASS source fields, incomplete data retained, leave fields retained, original snapshot overrides canonical and warning preserved",
);
