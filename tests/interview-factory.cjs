const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const XLSX = require('xlsx');
const cache = {};
class Response {
  constructor(body) { this.body = body; }
  static json(body) { return { body }; }
}
const deps = {
  'next/server': { NextResponse: Response },
  '@/lib/local-request': { guard: async () => null },
  '@/lib/prisma': { prisma: {} },
};
function load(file) {
  if (cache[file]) return cache[file];
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    module: m, exports: m.exports, Date, URL, URLSearchParams, Buffer, process,
    require: name => deps[name] || (name.startsWith('@/lib/') ? load('src/lib/' + name.slice(6) + '.ts') : require(name)),
  });
  return cache[file] = m.exports;
}
(async () => {
  const assignment = { interviewFactory: 'Fushan TV', workingFactory: 'VSIP TV', interviewDate: '04/05/2026' };
  const checks = load('src/lib/duplicate-check.ts');
  assert.equal(checks.sourceConflicts({ assignments: [assignment] }, { 'Nhà máy PV': 'Fushan TV', 'Ngày PV': '04/05/2026' }).length, 0);
  assert.ok(checks.sourceConflicts({ assignments: [assignment] }, { 'Nhà máy PV': 'VSIP TV', 'Ngày PV': '04/05/2026' }).includes('Cùng ngày PV nhưng khác công ty'));
  const person = { assignments: [{ ...assignment, employeeCode: 'A001' }] };
  const otherCompany = checks.sourceConflicts(person, { 'Nhà máy PV': 'Goertek', 'Ngày PV': '04/05/2026', 'Mã NV': 'B002' });
  assert.ok(otherCompany.includes('Cùng ngày PV nhưng khác công ty'));
  assert.equal(otherCompany.includes('Mã nhân viên không khớp lượt tuyển'), false, 'codes from different employers are not independently conflicting');
  assert.ok(checks.sourceConflicts(person, { 'Nhà máy PV': 'Fushan TV', 'Ngày PV': '04/05/2026', 'Mã NV': 'B002' }).includes('Mã nhân viên không khớp lượt tuyển'));
  const { matchesAssignment } = load('src/lib/reporting.ts');
  assert.equal(matchesAssignment(assignment, new URLSearchParams('factory=Fushan TV')), true);
  assert.equal(matchesAssignment(assignment, new URLSearchParams('factory=VSIP TV')), false);
  const fields = load('src/lib/duplicate-resolution.ts').reviewFields({}, assignment, { 'Nhà máy làm việc': 'Other' });
  assert.equal(fields.length, 0, 'review must not modify the retired database field');
  const route = load('src/app/api/excel-engine/export/route.ts');
  const response = await route.GET({ url: 'http://localhost/api/excel-engine/export?type=TEMPLATE_DS_TONG' });
  const workbook = XLSX.read(response.body, { type: 'buffer' });
  for (const name of ['DS_TONG', 'Tháng cũ']) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
    assert.equal(rows[0].includes('Nhà máy làm việc'), false);
    assert.equal(rows[0][2], 'Loại HD');
    for (const row of rows.slice(1)) {
      assert.equal(row.length, rows[0].length, 'removing a column must keep sample data aligned');
      assert.equal(row[2], 'Thời vụ');
      assert.match(String(row[rows[0].indexOf('số CCCD')]), /^\d{12}$/);
    }
  }
  console.log('PASS interview factory filtering, conflict detection, retired-field protection and template column alignment');
})().catch(error => { console.error(error); process.exitCode = 1; });
