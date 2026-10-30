const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");

function load(file, deps = {}, cache = {}) {
  if (cache[file]) return cache[file];
  const m = { exports: {} };
  cache[file] = m.exports;
  const source = fs.readFileSync(file, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(transpiled, {
    module: m,
    exports: m.exports,
    require: (n) => {
      if (n in deps) return deps[n];
      if (n.startsWith("@/")) return load("src/" + n.slice(2) + ".ts", deps, cache);
      return require(n);
    },
    process,
    Buffer,
    Date,
    Response,
    Map,
    Set,
    URL,
    URLSearchParams,
    console,
    crypto: require("node:crypto"),
  });
  return cache[file] = m.exports;
}

async function main() {
  console.log("=== BẮT ĐẦU KIỂM THỬ XÁC NHẬN (COMMIT) ĐẦY ĐỦ TRÊN BẢN SAO dev.db VỚI 2 FILE THẬT ===");

  const sourceDb = path.resolve("E:/Quản lí/.local/evolution/preview/dev.db");
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const replicaDb = path.join(tmpDir, `replica-commit-${Date.now()}.db`);
  fs.copyFileSync(sourceDb, replicaDb);
  console.log("Đã tạo bản sao replica tại:", replicaDb);

  const { PrismaClient } = require("../.generated/client");
  const testPrisma = new PrismaClient({ datasources: { db: { url: `file:${replicaDb}` } } });

  const initialWorkers = await testPrisma.worker.count();
  const initialBonuses = await testPrisma.bonusRecord.count();
  const initialAssigns = await testPrisma.workAssignment.count();
  console.log(`Bản sao ban đầu: ${initialWorkers} công nhân, ${initialAssigns} lượt tuyển, ${initialBonuses} bản thưởng.`);

  const fileTongPath = "D:\\Download\\DS_TONG.xlsx";
  const fileThuongPath = "D:\\Download\\DS Thưởng Hoàng - Tú test.xlsx";

  console.log("Đang nạp 2 file thực tế vào Buffer...");
  const t0 = Date.now();
  const bufTong = fs.readFileSync(fileTongPath);
  const bufThuong = fs.readFileSync(fileThuongPath);
  console.log(`Nạp xong 2 file (${((bufTong.length + bufThuong.length) / 1024 / 1024).toFixed(1)} MB) trong ${Date.now() - t0}ms`);

  const fileTong = { name: "DS_TONG.xlsx", size: bufTong.length, arrayBuffer: async () => bufTong };
  const fileThuong = { name: "DS Thưởng Hoàng - Tú test.xlsx", size: bufThuong.length, arrayBuffer: async () => bufThuong };

  // Setup mock Next.js server deps with testPrisma pointed to replicaDb
  const deps = {
    "@/lib/prisma": { prisma: testPrisma },
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({
          status: init.status || 200,
          ok: (init.status || 200) >= 200 && (init.status || 200) < 300,
          body,
          json: async () => body,
          clone: () => ({ json: async () => body }),
        }),
      },
    },
  };

  const route = load("src/app/api/excel-engine/import/route.ts", deps);

  // Bước 1: Quét Preview
  console.log("\n--- Bước 1: Quét Preview với 2 file thật ---");
  const tPrev0 = Date.now();
  const mockHeaders = {
    get: (h) => {
      const k = String(h).toLowerCase();
      if (k === "host") return "127.0.0.1:3000";
      if (k === "origin") return "http://127.0.0.1:3000";
      return null;
    }
  };
  const reqPreview = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return fileTong;
        if (k === "secondaryFile") return fileThuong;
        if (k === "confirm") return "false";
        if (k === "importType") return "AUTO";
        if (k === "smartMerge") return "true";
        return null;
      },
    }),
  };
  const resPreview = await route.POST(reqPreview);
  const prevBody = resPreview.body;
  console.log(`Preview xong trong ${Date.now() - tPrev0}ms: status = ${resPreview.status}, success = ${prevBody.success}`);
  assert.equal(prevBody.success, true);
  console.log(`Preview summary:`, {
    totalRows: prevBody.summary.totalRows,
    tongRows: prevBody.summary.tongRows,
    bonusRows: prevBody.summary.bonusRows,
    uniqueWorkers: prevBody.summary.uniqueWorkers,
    validAssignments: prevBody.summary.validAssignments,
    matchedAssignmentCount: prevBody.summary.matchedAssignmentCount,
    linkedBonusCount: prevBody.summary.linkedBonusCount,
  });

  const fingerprint = prevBody.previewFingerprint;
  const importRunId = prevBody.importRunId;

  // Bước 2: Commit thật trên bản sao DB
  console.log("\n--- Bước 2: Bấm Xác nhận (Commit) với cùng fingerprint trên bản sao DB ---");
  const tCommit0 = Date.now();
  const reqCommit = {
    method: "POST",
    url: "http://127.0.0.1:3000/api/excel-engine/import",
    headers: mockHeaders,
    formData: async () => ({
      getAll: () => [],
      get: (k) => {
        if (k === "file") return fileTong;
        if (k === "secondaryFile") return fileThuong;
        if (k === "confirm") return "true";
        if (k === "importType") return "COMBINED";
        if (k === "smartMerge") return "true";
        if (k === "previewFingerprint") return fingerprint;
        if (k === "importRunId") return importRunId;
        return null;
      },
    }),
  };

  const resCommit = await route.POST(reqCommit);
  const commitTime = Date.now() - tCommit0;
  console.log(`Commit kết thúc sau: ${commitTime}ms (${(commitTime / 1000).toFixed(1)} giây)`);
  console.log(`Commit response status = ${resCommit.status}, success = ${resCommit.body.success}`);

  if (!resCommit.body.success) {
    console.error("Commit lỗi:", resCommit.body.message);
  } else {
    console.log("Commit thành công rực rỡ!", {
      sourceRowsSaved: resCommit.body.sourceRowsSaved,
      normalizedSaved: resCommit.body.normalizedSaved,
    });
  }

  // Bước 3: Kiểm tra số liệu DB sau commit
  const finalWorkers = await testPrisma.worker.count();
  const finalAssigns = await testPrisma.workAssignment.count();
  const finalBonuses = await testPrisma.bonusRecord.count();
  const finalLinked = await testPrisma.bonusRecord.count({ where: { assignmentId: { not: null } } });
  const finalAuditLogs = await testPrisma.auditLog.count();
  console.log(`\nSố liệu bản sao sau commit:`);
  console.log(`- Công nhân: ${finalWorkers} (ban đầu: ${initialWorkers})`);
  console.log(`- Lượt tuyển: ${finalAssigns} (ban đầu: ${initialAssigns})`);
  console.log(`- Bản thưởng: ${finalBonuses} (ban đầu: ${initialBonuses})`);
  console.log(`- Bản thưởng ĐÃ NỐI assignmentId: ${finalLinked}`);
  console.log(`- Tổng bản ghi AuditLog truy vết: ${finalAuditLogs}`);

  await testPrisma.$disconnect();
  try {
    fs.unlinkSync(replicaDb);
    const wal = replicaDb + "-wal"; if (fs.existsSync(wal)) fs.unlinkSync(wal);
    const shm = replicaDb + "-shm"; if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch {}
  console.log("\nĐã dọn dẹp bản sao tạm an toàn.");
}

main().catch(err => {
  console.error("Lỗi:", err);
  process.exit(1);
});
