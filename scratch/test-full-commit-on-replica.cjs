const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

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

function getDirectoryManifest(dirPath) {
  const manifest = {};
  if (!fs.existsSync(dirPath)) return manifest;
  function walk(currentDir, baseDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath, baseDir);
      } else if (entry.isFile()) {
        const buf = fs.readFileSync(fullPath);
        manifest[relPath] = {
          size: buf.length,
          sha256: crypto.createHash("sha256").update(buf).digest("hex"),
        };
      }
    }
  }
  walk(dirPath, dirPath);
  return manifest;
}

async function main() {
  console.log("=== BẮT ĐẦU KIỂM THỬ XÁC NHẬN (COMMIT) ĐẦY ĐỦ TRÊN BẢN SAO NHẤT QUÁN VỚI 2 FILE THẬT ===");

  const sourceDb = path.resolve("E:/Quản lí/.local/evolution/preview/dev.db");
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // [Khắc phục Điểm 1 & 2 từ Codex: Kiểm tra toàn vẹn thư mục bằng SHA-256 Manifest đệ quy]
  const appSourceDir = path.resolve(".local/source-imports");
  const appRecoveryDir = path.resolve(".local/import-recovery");
  const beforeSourceManifest = getDirectoryManifest(appSourceDir);
  const beforeRecoveryManifest = getDirectoryManifest(appRecoveryDir);

  const sandboxDir = path.join(tmpDir, `sandbox-commit-${Date.now()}`);
  const sourceImportsDir = path.join(sandboxDir, "source-imports");
  const recoveryDir = path.join(sandboxDir, "import-recovery");
  fs.mkdirSync(sourceImportsDir, { recursive: true });
  fs.mkdirSync(recoveryDir, { recursive: true });

  process.env.LOCAL_IMPORT_SOURCE_DIR = sourceImportsDir;
  process.env.LOCAL_IMPORT_RECOVERY_DIR = recoveryDir;
  console.log(`[CÔ LẬP MÔI TRƯỜNG]`);
  console.log(`- Snapshot Store: ${process.env.LOCAL_IMPORT_SOURCE_DIR}`);
  console.log(`- Recovery Dir:   ${process.env.LOCAL_IMPORT_RECOVERY_DIR}`);
  console.log(`- Thư mục chính app trước chạy: source-imports=${Object.keys(beforeSourceManifest).length} files, import-recovery=${Object.keys(beforeRecoveryManifest).length} files (đã ghi nhận SHA-256 manifest)`);

  // [Khắc phục Điểm 3: Tạo bản sao SQLite nhất quán bằng VACUUM INTO, an toàn với WAL]
  const replicaDb = path.join(sandboxDir, `replica-commit.db`);
  console.log("\n[1. TẠO REPLICA NHẤT QUÁN]");
  const tVac0 = Date.now();
  const dbSync = new DatabaseSync(sourceDb, { readOnly: true });
  dbSync.exec(`VACUUM INTO '${replicaDb.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  dbSync.close();
  const tVac = Date.now() - tVac0;
  console.log(`- Replica DB tạo bằng VACUUM INTO trong ${tVac}ms: ${replicaDb}`);
  console.log(`- Kích thước replica: ${(fs.statSync(replicaDb).size / 1024 / 1024).toFixed(2)} MB`);

  const { PrismaClient } = require("../.generated/client");
  const testPrisma = new PrismaClient({ datasources: { db: { url: `file:${replicaDb}` } } });

  try {
    const initialWorkers = await testPrisma.worker.count();
    const initialBonuses = await testPrisma.bonusRecord.count();
    const initialAssigns = await testPrisma.workAssignment.count();
    const initialAuditLogs = await testPrisma.auditLog.count();
    console.log(`- Số liệu ban đầu: ${initialWorkers} công nhân, ${initialAssigns} lượt tuyển, ${initialBonuses} bản thưởng, ${initialAuditLogs} auditLogs.`);

    const fileTongPath = "D:\\Download\\DS_TONG.xlsx";
    const fileThuongPath = "D:\\Download\\DS Thưởng Hoàng - Tú test.xlsx";

    assert.ok(fs.existsSync(fileTongPath), `File không tồn tại: ${fileTongPath}`);
    assert.ok(fs.existsSync(fileThuongPath), `File không tồn tại: ${fileThuongPath}`);

    console.log("\n[2. NẠP 2 FILE THẬT]");
    const tRead0 = Date.now();
    const bufTong = fs.readFileSync(fileTongPath);
    const bufThuong = fs.readFileSync(fileThuongPath);
    const readDuration = Date.now() - tRead0;
    console.log(`- Nạp xong 2 file (${((bufTong.length + bufThuong.length) / 1024 / 1024).toFixed(1)} MB) trong ${readDuration}ms`);

    const fileTong = { name: "DS_TONG.xlsx", size: bufTong.length, arrayBuffer: async () => bufTong };
    const fileThuong = { name: "DS Thưởng Hoàng - Tú test.xlsx", size: bufThuong.length, arrayBuffer: async () => bufThuong };

    // Setup mock Next.js server deps với testPrisma trỏ tới replicaDb
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
    console.log("\n[3. QUÉT PREVIEW]");
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
    const previewDuration = Date.now() - tPrev0;
    const prevBody = resPreview.body;

    console.log(`- Preview hoàn thành sau ${previewDuration}ms (${(previewDuration / 1000).toFixed(2)}s)`);

    // [Khắc phục Điểm 2: Assertions xác nhận Preview]
    assert.strictEqual(resPreview.status, 200, "Preview HTTP status phải là 200");
    assert.strictEqual(prevBody.success, true, "Preview body success phải là true");
    assert.ok(prevBody.previewFingerprint && prevBody.previewFingerprint.startsWith("cells-v1:"), "Preview phải có cells-v1 fingerprint");
    assert.ok(prevBody.importRunId, "Preview phải trả về importRunId");
    assert.ok(prevBody.summary.totalRows > 0, "totalRows phải > 0");

    console.log(`- Chỉ số Preview:`, {
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
    console.log("\n[4. XÁC NHẬN COMMIT TRÊN REPLICA DB]");
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
    const commitDuration = Date.now() - tCommit0;
    console.log(`- Commit hoàn thành sau ${commitDuration}ms (${(commitDuration / 1000).toFixed(2)}s)`);

    // [Khắc phục Điểm 2: Assertions xác nhận Commit thành công và dữ liệu đúng]
    assert.strictEqual(resCommit.status, 200, `Commit HTTP status phải là 200, nhận: ${resCommit.status} - ${JSON.stringify(resCommit.body)}`);
    assert.strictEqual(resCommit.body.success, true, `Commit body.success phải là true, nhận: ${resCommit.body.message}`);
    assert.ok(resCommit.body.sourceRowsSaved > 0, "sourceRowsSaved phải > 0");
    assert.ok(resCommit.body.normalizedSaved > 0, "normalizedSaved phải > 0");

    console.log("- Kết quả phản hồi Commit:", {
      success: resCommit.body.success,
      sourceRowsSaved: resCommit.body.sourceRowsSaved,
      normalizedSaved: resCommit.body.normalizedSaved,
    });

    // Bước 3: Kiểm tra số liệu DB sau commit
    console.log("\n[5. KIỂM TRA SỐ LIỆU DB SAU COMMIT]");
    const finalWorkers = await testPrisma.worker.count();
    const finalAssigns = await testPrisma.workAssignment.count();
    const finalBonuses = await testPrisma.bonusRecord.count();
    const finalLinked = await testPrisma.bonusRecord.count({ where: { assignmentId: { not: null } } });
    const finalAuditLogs = await testPrisma.auditLog.count();

    console.log(`- Công nhân  : ${finalWorkers} (ban đầu: ${initialWorkers}, chênh lệch: +${finalWorkers - initialWorkers})`);
    console.log(`- Lượt tuyển : ${finalAssigns} (ban đầu: ${initialAssigns}, chênh lệch: +${finalAssigns - initialAssigns})`);
    console.log(`- Bản thưởng : ${finalBonuses} (ban đầu: ${initialBonuses}, chênh lệch: +${finalBonuses - initialBonuses})`);
    console.log(`- Thưởng nối : ${finalLinked}`);
    console.log(`- AuditLog   : ${finalAuditLogs} (ban đầu: ${initialAuditLogs}, chênh lệch: +${finalAuditLogs - initialAuditLogs})`);

    // Strict Database Assertions
    assert.ok(finalWorkers >= initialWorkers, "Worker không được giảm");
    assert.ok(finalAssigns > initialAssigns, "WorkAssignment phải tăng sau khi import DS_TONG");
    assert.ok(finalBonuses >= initialBonuses, "BonusRecord không được giảm");
    assert.ok(finalLinked > 0, "Phải có BonusRecord được nối assignmentId hợp lệ");
    assert.ok(finalAuditLogs > initialAuditLogs, "AuditLog phải được ghi nhận đầy đủ");

    // [Khắc phục Điểm 1 & 2: Kiểm tra biên nhận AuditLog và Snapshot cô lập]
    console.log("\n[6. KIỂM TRA BIÊN NHẬN AUDIT VÀ SNAPSHOT CÔ LẬP]");
    const auditReceipt = await testPrisma.auditLog.findUnique({
      where: { id: "import-run:" + importRunId.toLowerCase() }
    });
    assert.ok(auditReceipt, `Phải có AuditLog receipt cho import-run:${importRunId}`);
    assert.strictEqual(auditReceipt.action, "COMMIT_IMPORT", "AuditLog receipt action phải là COMMIT_IMPORT");
    console.log(`✔ Đã tìm thấy AuditLog biên nhận hợp lệ cho phiên ${importRunId}`);

    const snapshotFiles = fs.readdirSync(sourceImportsDir);
    console.log(`- Snapshot files trong sandbox: ${snapshotFiles.length} file:`, snapshotFiles);
    assert.ok(snapshotFiles.length >= 2, "Phải có ít nhất 2 snapshot file nguồn được lưu trong sandbox (DS_TONG và DS_THUONG)");

    // [Khắc phục Điểm 2 từ Codex: Đối soát toàn vẹn thư mục thật bằng SHA-256 Manifest đệ quy]
    const afterSourceManifest = getDirectoryManifest(appSourceDir);
    const afterRecoveryManifest = getDirectoryManifest(appRecoveryDir);
    assert.deepStrictEqual(
      afterSourceManifest,
      beforeSourceManifest,
      "Thư mục .local/source-imports chính bị thay đổi file hoặc nội dung (SHA-256 lệch)!",
    );
    assert.deepStrictEqual(
      afterRecoveryManifest,
      beforeRecoveryManifest,
      "Thư mục .local/import-recovery chính bị thay đổi file hoặc nội dung (SHA-256 lệch)!",
    );
    console.log(`✔ Khẳng định toàn vẹn tuyệt đối: SHA-256 Manifest của .local/source-imports (${Object.keys(beforeSourceManifest).length} files) và .local/import-recovery (${Object.keys(beforeRecoveryManifest).length} files) đồng nhất 100% trước và sau chạy.`);

    // [Khắc phục Điểm 1 từ Codex: Đối soát toàn diện 100% bản ghi thưởng có liên kết]
    console.log("\n[7. ĐỐI SOÁT TOÀN DIỆN 100% BẢN GHI THƯỞNG CÓ LIÊN KẾT]");
    const totalLinkedBonuses = await testPrisma.bonusRecord.count({
      where: { assignmentId: { not: null } },
    });
    console.log(`- Tổng số bản ghi thưởng có liên kết trong DB replica: ${totalLinkedBonuses}`);
    assert.ok(totalLinkedBonuses > 0, "Phải có bản ghi thưởng được liên kết");

    let totalChecked = 0;
    let workerIdMatched = 0;
    let workerIdMismatched = 0;

    let companyMatched = 0;
    let companyMismatched = 0;
    let companyMissing = 0;

    let dateMatched = 0;
    let dateMismatched = 0;
    let dateMissing = 0;

    let codeMatched = 0;
    let codeMismatched = 0;
    let codeMissing = 0;

    const { sameFactory, identityText } = load("src/lib/duplicate-check.ts");
    const { dateKey } = load("src/lib/worker-validation.ts");

    const BATCH_SIZE = 10000;
    for (let skip = 0; skip < totalLinkedBonuses; skip += BATCH_SIZE) {
      const batch = await testPrisma.bonusRecord.findMany({
        where: { assignmentId: { not: null } },
        orderBy: { id: "asc" },
        skip,
        take: BATCH_SIZE,
        include: { assignment: true },
      });

      for (const b of batch) {
        totalChecked++;
        const a = b.assignment;
        assert.ok(a, `Bản ghi thưởng ${b.id} có assignmentId nhưng không tìm thấy WorkAssignment trong DB!`);

        // 1. WorkerId: Phải khớp 100%
        if (b.workerId === a.workerId) {
          workerIdMatched++;
        } else {
          workerIdMismatched++;
        }

        // 2. Công ty / Nhà máy (chuẩn hóa danh tính công ty)
        const compB = identityText(b.company);
        const facA = identityText(a.interviewFactory);
        if (!compB || !facA) {
          companyMissing++;
        } else if (sameFactory(b.company, a.interviewFactory) || compB === facA) {
          companyMatched++;
        } else {
          companyMismatched++;
        }

        // 3. Ngày phỏng vấn (chỉ khớp khi cả 2 ngày đều chuẩn hóa thành công thành key ngày hợp lệ)
        const keyB = dateKey(b.interviewDate);
        const keyA = dateKey(a.interviewDate);
        if (!keyB || !keyA) {
          dateMissing++;
        } else if (keyB === keyA) {
          dateMatched++;
        } else {
          dateMismatched++;
        }

        // 4. Mã nhân viên (chuẩn hóa Unicode NFC và khoảng trắng qua identityText)
        const codeB = identityText(b.workerCode);
        const codeA = identityText(a.employeeCode);
        if (!codeB || !codeA) {
          codeMissing++;
        } else if (codeB === codeA) {
          codeMatched++;
        } else {
          codeMismatched++;
        }
      }
    }

    // [Khắc phục Điểm 3 từ Codex: Assert duyệt đủ 100% bản ghi không bỏ sót]
    assert.strictEqual(
      totalChecked,
      totalLinkedBonuses,
      `Tổng số bản ghi duyệt thực tế (${totalChecked}) phải bằng chính xác totalLinkedBonuses (${totalLinkedBonuses})`,
    );

    console.log(`- Kết quả đối soát toàn diện 100% (${totalChecked}/${totalLinkedBonuses} bản ghi liên kết):`);
    console.log(`  + WorkerId : Khớp=${workerIdMatched}, Sai=${workerIdMismatched}`);
    console.log(`  + Công ty  : Khớp=${companyMatched}, Sai=${companyMismatched}, Thiếu 1 bên=${companyMissing}`);
    console.log(`  + Ngày PV  : Khớp=${dateMatched}, Sai=${dateMismatched}, Thiếu 1 bên=${dateMissing}`);
    console.log(`  + Mã NV    : Khớp=${codeMatched}, Sai=${codeMismatched}, Thiếu 1 bên=${codeMissing}`);

    // Strict assertions
    assert.strictEqual(workerIdMismatched, 0, "Không được có bất kỳ bản ghi thưởng nào sai lệch workerId với lượt tuyển!");
    assert.strictEqual(companyMismatched, 0, "Không được có bất kỳ bản ghi thưởng nào sai lệch công ty/nhà máy khi cả hai bên đều có dữ liệu!");
    assert.strictEqual(dateMismatched, 0, "Không được có bất kỳ bản ghi thưởng nào sai lệch ngày phỏng vấn khi cả hai bên đều có ngày hợp lệ!");
    assert.strictEqual(codeMismatched, 0, "Không được có bất kỳ bản ghi thưởng nào sai lệch mã nhân viên khi cả hai bên đều có dữ liệu!");

    // [Khắc phục Điểm 4: Lưu kết quả log benchmark ra file có bằng chứng]
    const outputsDir = path.resolve("outputs");
    if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });
    const evidenceLogPath = path.join(outputsDir, `benchmark-evidence-${Date.now()}.json`);
    const evidenceData = {
      timestamp: new Date().toISOString(),
      status: "SUCCESS",
      metrics: {
        replicaVacuumMs: tVac,
        readFilesMs: readDuration,
        previewMs: previewDuration,
        commitMs: commitDuration,
        workers: { before: initialWorkers, after: finalWorkers, added: finalWorkers - initialWorkers },
        assignments: { before: initialAssigns, after: finalAssigns, added: finalAssigns - initialAssigns },
        bonuses: { before: initialBonuses, after: finalBonuses, added: finalBonuses - initialBonuses, linked: finalLinked },
        auditLogs: { before: initialAuditLogs, after: finalAuditLogs, added: finalAuditLogs - initialAuditLogs },
        snapshotsCreatedInSandbox: snapshotFiles.length,
        fullRelationalAudit: {
          totalChecked,
          workerIdMatches: workerIdMatched,
          workerIdMismatches: workerIdMismatched,
          companyMatches: companyMatched,
          companyMismatches: companyMismatched,
          companyMissing,
          dateMatches: dateMatched,
          dateMismatches: dateMismatched,
          dateMissing,
          codeMatches: codeMatched,
          codeMismatches: codeMismatched,
          codeMissing,
        },
        mainAppManifestVerified: {
          sourceImportsFilesCount: Object.keys(beforeSourceManifest).length,
          importRecoveryFilesCount: Object.keys(beforeRecoveryManifest).length,
          byteAndHashIdentical: true,
        },
      }
    };
    fs.writeFileSync(evidenceLogPath, JSON.stringify(evidenceData, null, 2), "utf8");
    console.log(`✔ Đã lưu bằng chứng đối soát benchmark toàn diện tại: ${evidenceLogPath}`);

    console.log("\n=== TOÀN BỘ KIỂM THỬ XÁC NHẬN VÀ ASSERTIONS ĐÃ ĐẠT 100%! ===");
  } finally {
    await testPrisma.$disconnect();
    try {
      if (fs.existsSync(sandboxDir)) {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
        console.log("✔ Đã dọn dẹp thư mục sandbox cô lập hoàn toàn.");
      }
    } catch (cleanErr) {
      console.warn("Cảnh báo dọn dẹp sandbox:", cleanErr.message);
    }
  }
}

main().catch(err => {
  console.error("\n❌ KIỂM THỬ THẤT BẠI VỚI LỖI:", err);
  process.exit(1);
});
