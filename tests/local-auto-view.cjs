const fs = require("fs"),
  ts = require("typescript"),
  vm = require("vm"),
  assert = require("assert/strict");
const m = { exports: {} },
  env = { LOCAL_DEMO_AUTO_VIEW: "1" };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/lib/auth.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText,
  {
    module: m,
    exports: m.exports,
    process: { env },
    Buffer,
    URL,
    Date,
    setTimeout,
    require: (n) =>
      n === "next/server"
        ? { NextResponse: { json: (b, o) => ({ body: b, ...o }) } }
        : n === "node:fs/promises"
          ? {
              readFile: async () => {
                throw Error("no auth file");
              },
            }
          : require(n),
  },
);
const req = (host) => ({
  method: "GET",
  headers: { get: (k) => (k === "host" ? host : null) },
  cookies: { get: () => null },
});
(async () => {
  assert.equal((await m.exports.identity(req("127.0.0.1:3005"))).role, "ADMIN");
  assert.equal(await m.exports.identity(req("example.com")), null);
  const stale = req("127.0.0.1:3005");
  stale.cookies = { get: () => ({ value: "expired.or.invalid" }) };
  assert.equal(await m.exports.identity(stale), null);
  assert.equal(
    await m.exports.guard(req("127.0.0.1:3005"), "worker:write"),
    null,
  );
  assert.equal(await m.exports.identity(req("localhost.evil.example")), null);
  env.LOCAL_DEMO_AUTO_VIEW = "0";
  assert.equal(await m.exports.identity(req("127.0.0.1:3005")), null);
  console.log(
    "PASS explicit local demo, external and deceptive hosts rejected, invalid cookies rejected, disabled mode requires auth",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
