const fs = require('fs'), ts = require('typescript'), vm = require('vm');
function load(file, deps = {}) { const m = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: m, exports: m.exports, require: n => deps[n] }); return m.exports; }
module.exports = load('src/lib/duplicate-check.ts', { '@/lib/worker-validation': load('src/lib/worker-validation.ts') });
