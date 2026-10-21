const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/local-request.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  module: mod, exports: mod.exports, URL, Date,
  require: () => ({ NextResponse: { json: (body, options) => ({ body, ...options }) } }),
});
const { guard, identity } = mod.exports;
const request = (method, host = '127.0.0.1:3000', origin) => ({
  method, url: `http://${host}/api/workers`,
  headers: { get: name => ({ host, origin }[name] || null) },
});
(async () => {
  assert.equal(await guard(request('GET')), null, 'local reads need no login or cookie');
  assert.equal(await guard(request('POST', '127.0.0.1:3000', 'http://127.0.0.1:3000')), null);
  assert.equal((await identity(request('GET'))).username, 'Người dùng local');
  assert.equal((await guard(request('GET', 'example.com'))).status, 403);
  assert.equal((await guard(request('POST'))).status, 403);
  assert.equal((await guard(request('POST', '127.0.0.1:3000', 'https://example.com'))).status, 403);
  assert.equal((await guard(request('POST', '127.0.0.1:3000', 'http://127.0.0.1:4000'))).status, 403);
  console.log('PASS direct local access without session; external host and cross-origin mutations blocked');
})().catch(error => { console.error(error); process.exitCode = 1; });
