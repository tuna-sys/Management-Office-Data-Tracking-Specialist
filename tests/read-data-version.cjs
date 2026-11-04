const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function load(file, deps) {
  const module = { exports: {} };
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    require: (name) => deps[name] || require(name),
    Buffer,
    process,
  });
  return module.exports;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "read-data-version-"));
  const database = path.join(dir, "test.db");
  const walPath = `${database}-wal`;
  try {
    fs.writeFileSync(database, Buffer.alloc(100));
    const pageSize = 512;
    const walSize = 3 * 1024 * 1024;
    const wal = Buffer.alloc(walSize);
    wal.writeUInt32BE(0x377f0682, 0);
    wal.writeUInt32BE(pageSize, 8);
    const lastFrameOffset = walSize - (pageSize + 24);
    wal.fill(0x2a, lastFrameOffset, lastFrameOffset + 24);
    fs.writeFileSync(walPath, wal);

    const deps = {
      "@/lib/prisma": {
        prisma: {
          $queryRawUnsafe: async () => [{ name: "main", file: database }],
        },
      },
      "@/lib/read-cache": { readCacheEpoch: () => 0 },
    };
    const { readDataVersion } = load(
      "src/lib/read-data-version.ts",
      deps,
    );
    const first = await readDataVersion();
    const second = await readDataVersion();
    assert.equal(first, second, "large WAL version must be stable when unchanged");

    const modified = Buffer.from(wal);
    modified.fill(0x7b, lastFrameOffset, lastFrameOffset + 24);
    fs.writeFileSync(walPath, modified);
    const third = await readDataVersion();
    assert.notEqual(first, third, "large WAL frame change must invalidate the version");
    console.log("PASS: stable version for unchanged large WAL; detects changed final frame without whole-file hashing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
