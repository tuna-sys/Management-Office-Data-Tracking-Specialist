const fs = require('node:fs'), vm = require('node:vm');
const ts = require('typescript'), assert = require('node:assert/strict');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/province-name.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: m, exports: m.exports });
const { provinceName } = m.exports;
assert.equal(provinceName('Quảng Bìnhf'), 'Quảng Bình');
assert.equal(provinceName('Cao Bằng. Cao Bằng'), 'Cao Bằng');
assert.equal(provinceName(' Cao Bằng, Cao Bằng '), 'Cao Bằng');
assert.equal(provinceName('Tỉnh Cao Bằng'), 'Cao Bằng');
assert.equal(provinceName('Quảng Bình'), 'Quảng Bình');
assert.equal(provinceName('Bắc Ninh'), 'Bắc Ninh');
assert.equal(provinceName('Địa danh chưa rõ'), 'Địa danh chưa rõ');
assert.equal(provinceName('', 'Xã A, Huyện B, Kon Tum'), 'Kon Tum');
assert.equal(provinceName(''), '');
const counts = {};
for (const value of ['Quảng Bình', 'Quảng Bìnhf', 'Cao Bằng. Cao Bằng', 'Cao Bằng']) {
  const key = provinceName(value);
  counts[key] = (counts[key] || 0) + 1;
}
assert.deepEqual(counts, { 'Quảng Bình': 2, 'Cao Bằng': 2 });
console.log('PASS province typos, duplicate names, address fallback, unknown names and merged totals');
