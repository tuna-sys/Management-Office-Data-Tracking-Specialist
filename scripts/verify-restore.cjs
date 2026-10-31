/**
 * scripts/verify-restore.cjs
 * Kiểm tra và xác minh tính toàn vẹn của bản sao lưu SQLite trên một thư mục độc lập (.local/restore-test).
 * 
 * Các bước kiểm chứng:
 *  1. Đối chiếu checksum SHA256 của file backup với file metadata (.meta.json) lưu lúc tạo.
 *  2. Khôi phục thử nghiệm ra thư mục riêng biệt, tuyệt đối không chạm hoặc ghi đè DB thật.
 *  3. Thực hiện PRAGMA integrity_check, quick_check, foreign_key_check.
 *  4. Đối chiếu số lượng bản ghi giữa DB khôi phục với metadata và CSDL nguồn.
 *  5. Kết luận phân loại chính xác: PASS, WARN, hoặc FAIL.
 *  6. Tự động dọn dẹp file tạm sau khi kiểm thử (trừ khi có cờ --keep).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  resolveDatabasePath,
  calculateSha256,
  formatBytes,
  openSqliteReadOnly,
  runSqlitePragmas,
  getUserTables,
  getTableCounts,
  findMetaFilePath,
} = require('./lib/sqlite-backup.cjs');

function findLatestBackup(backupDir) {
  if (!fs.existsSync(backupDir)) return null;
  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      return { path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

function verifyRestore(options = {}) {
  const startTime = Date.now();
  const backupDir = path.resolve(options.backupDir || '.local/backups');
  let backupFile = options.backupFile;

  if (!backupFile) {
    backupFile = findLatestBackup(backupDir);
  } else {
    backupFile = path.resolve(backupFile);
  }

  if (!backupFile || !fs.existsSync(backupFile)) {
    throw new Error(`Không tìm thấy file sao lưu để kiểm tra khôi phục: ${backupFile || backupDir}`);
  }

  console.log('='.repeat(65));
  console.log('[VERIFY-RESTORE] Bắt đầu quy trình kiểm tra khôi phục CSDL');
  console.log(`- Bản sao lưu kiểm tra:    ${backupFile}`);
  console.log('='.repeat(65));

  // BƯỚC 1: Đối chiếu checksum SHA256 và kiểm tra tính hợp lệ của metadata
  console.log('[BƯỚC 1/5] Kiểm tra SHA256 và cấu trúc metadata gốc...');
  const currentBackupSha256 = calculateSha256(backupFile);
  const metaFile = findMetaFilePath(backupFile);
  let metadata = null;
  let metadataValid = false;
  let metaValidationIssue = null;
  let metaChecksumValid = false;

  if (metaFile && fs.existsSync(metaFile)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata) ||
        typeof metadata.sha256 !== 'string' ||
        !/^[0-9a-fA-F]{64}$/.test(metadata.sha256) ||
        !metadata.counts ||
        typeof metadata.counts !== 'object' ||
        Array.isArray(metadata.counts)
      ) {
        metaValidationIssue = 'Metadata thiếu hoặc sai định dạng trường bắt buộc (sha256 hex 64 ký tự, counts dạng object)';
      } else {
        // Kiểm tra từng giá trị trong counts phải là số nguyên không âm
        let allCountsValid = true;
        for (const [tbl, val] of Object.entries(metadata.counts)) {
          if (!Number.isInteger(val) || val < 0) {
            allCountsValid = false;
            break;
          }
        }
        if (!allCountsValid) {
          metaValidationIssue = 'Giá trị số lượng trong metadata.counts phải là số nguyên không âm';
        } else {
          metadataValid = true;
        }
      }
    } catch {
      metaValidationIssue = 'Không đọc hoặc parse được file metadata JSON';
    }
  } else {
    metaValidationIssue = 'Không có file .meta.json đi kèm';
  }

  if (metadataValid) {
    if (metadata.sha256.toLowerCase() === currentBackupSha256.toLowerCase()) {
      metaChecksumValid = true;
      console.log(`  -> SHA256 khớp tuyệt đối với metadata: ${currentBackupSha256}`);
    } else {
      console.error(`  -> LỖI: Checksum không khớp metadata! (Hiện tại: ${currentBackupSha256}, Meta: ${metadata.sha256})`);
    }
  } else {
    console.log(`  -> [CẢNH BÁO] ${metaValidationIssue}. Bỏ qua đối chiếu checksum gốc.`);
  }

  // Nếu metadata hợp lệ mà checksum sai lệch -> Dừng ngay trước khi tạo thư mục tạm (tránh để lại rác)
  if (metadataValid && !metaChecksumValid) {
    throw new Error('Xác thực thất bại: Bản sao lưu đã bị thay đổi hoặc hư hại so với metadata gốc (sai checksum SHA256)!');
  }

  // BƯỚC 2: Khởi tạo thư mục tạm kiểm thử riêng biệt
  const testRestoreParentDir = path.resolve(options.restoreDir || '.local/restore-test');
  fs.mkdirSync(testRestoreParentDir, { recursive: true });

  const runDir = fs.mkdtempSync(path.join(testRestoreParentDir, 'run-'));
  const restoredFile = path.join(runDir, 'restored.db');
  console.log(`- Thư mục khôi phục tạm:   ${runDir}`);

  let pragmaResults = null;
  let userTables = [];
  let restoredCounts = {};
  let structuralIntegrityPass = false;
  let metaMissingTables = [];
  let metaCountMismatches = [];
  let sourceDbPath = null;
  let sourceCounts = {};
  let sourceCountsMatch = true;
  const sourceDiscrepancies = [];

  try {
    console.log('[BƯỚC 2/5] Sao chép file backup sang thư mục khôi phục tạm...');
    const copyStart = Date.now();
    fs.copyFileSync(backupFile, restoredFile);
    const copyDuration = Date.now() - copyStart;

    const restoredSha256 = calculateSha256(restoredFile);
    if (currentBackupSha256 !== restoredSha256) {
      throw new Error('Lỗi copy: SHA256 sau khi sao chép không khớp với file backup gốc!');
    }
    console.log(`  -> Sao chép thành công và toàn vẹn (${copyDuration} ms)`);

    // BƯỚC 3: Kiểm tra tính toàn vẹn cấu trúc SQLite (PRAGMA checks)
    console.log('[BƯỚC 3/5] Thực hiện kiểm tra tính toàn vẹn cấu trúc SQLite (PRAGMA checks)...');
    const restoredDb = openSqliteReadOnly(restoredFile);

    try {
      pragmaResults = runSqlitePragmas(restoredDb);
      userTables = getUserTables(restoredDb);
      restoredCounts = getTableCounts(restoredDb, userTables);
    } finally {
      restoredDb.close();
    }

    console.log(`  -> PRAGMA integrity_check:   ${pragmaResults.integrityOk ? 'PASS (ok)' : 'FAIL'}`);
    console.log(`  -> PRAGMA quick_check:       ${pragmaResults.quickCheckOk ? 'PASS (ok)' : 'FAIL'}`);
    console.log(`  -> PRAGMA foreign_key_check: ${pragmaResults.foreignKeyOk ? 'PASS (0 vi phạm)' : `FAIL (${pragmaResults.foreignKeyErrors.length} lỗi)`}`);

    structuralIntegrityPass = pragmaResults.integrityOk && pragmaResults.quickCheckOk && pragmaResults.foreignKeyOk;

    // BƯỚC 4: Đối chiếu số lượng bản ghi và danh sách bảng
    console.log('[BƯỚC 4/5] Đối chiếu số liệu bản ghi với metadata và DB nguồn...');
    if (metadataValid) {
      for (const tbl of userTables) {
        if (metadata.counts[tbl] === undefined) {
          metaMissingTables.push(tbl);
          console.warn(`  -> Metadata thiếu bảng: ${tbl}`);
        } else if (restoredCounts[tbl] !== metadata.counts[tbl]) {
          metaCountMismatches.push({ table: tbl, db: restoredCounts[tbl], meta: metadata.counts[tbl] });
          console.warn(`  -> Lệch số lượng ở bảng ${tbl}: DB=${restoredCounts[tbl]}, Meta=${metadata.counts[tbl]}`);
        }
      }
    }

    try {
      sourceDbPath = resolveDatabasePath(options.dbPath || (metadata ? metadata.sourceDbPath : null));
      if (fs.existsSync(sourceDbPath)) {
        const sourceDb = openSqliteReadOnly(sourceDbPath);
        try {
          sourceCounts = getTableCounts(sourceDb, userTables);
          for (const tbl of userTables) {
            if (sourceCounts[tbl] !== restoredCounts[tbl]) {
              sourceCountsMatch = false;
              sourceDiscrepancies.push({ table: tbl, source: sourceCounts[tbl], restored: restoredCounts[tbl] });
            }
          }
        } finally {
          sourceDb.close();
        }
      }
    } catch (err) {
      console.warn(`  -> Bỏ qua đối chiếu DB nguồn trực tiếp: ${err.message}`);
    }

    console.log('  -> Thống kê bản ghi khôi phục:');
    const sampleTables = ['Worker', 'BankAccount', 'AuditLog', 'BonusRecord', 'LaborStatus'];
    for (const tbl of sampleTables) {
      if (restoredCounts[tbl] !== undefined) {
        const sCount = sourceCounts[tbl] !== undefined ? sourceCounts[tbl] : 'N/A';
        console.log(`     * ${tbl.padEnd(16)}: ${String(restoredCounts[tbl]).padStart(6)} (Nguồn: ${String(sCount).padStart(6)})`);
      }
    }
  } finally {
    // BƯỚC 5: Dọn dẹp môi trường khôi phục thử nghiệm trong finally để đảm bảo không rò rỉ file tạm
    console.log('[BƯỚC 5/5] Dọn dẹp môi trường kiểm thử...');
    if (!options.keep) {
      if (fs.existsSync(runDir)) {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
      console.log(`  -> Đã xóa thư mục khôi phục tạm: ${runDir}`);
    } else {
      console.log(`  -> Giữ lại thư mục khôi phục theo yêu cầu (--keep): ${runDir}`);
    }
  }

  // XÁC ĐỊNH TRẠNG THÁI KẾT LUẬN
  let status = 'PASS';
  let statusMessage = 'Hoàn toàn đạt chuẩn toàn vẹn cấu trúc và khớp dữ liệu';

  if (!structuralIntegrityPass) {
    status = 'FAIL';
    statusMessage = 'Thất bại: Lỗi cấu trúc CSDL SQLite hoặc lỗi khóa ngoại!';
  } else if (metadataValid && !metaChecksumValid) {
    status = 'FAIL';
    statusMessage = 'Thất bại: Checksum SHA256 không khớp với metadata gốc!';
  } else if (metadataValid && metaCountMismatches.length > 0) {
    status = 'FAIL';
    statusMessage = `Thất bại: Số lượng bản ghi trong CSDL khôi phục sai lệch so với metadata (${metaCountMismatches.map((m) => m.table).join(', ')})!`;
  } else if (!metadataValid) {
    status = 'WARN';
    statusMessage = `Cảnh báo: CSDL toàn vẹn cấu trúc SQLite nhưng ${metaValidationIssue} (chưa xác minh đầy đủ)`;
  } else if (metaMissingTables.length > 0) {
    status = 'WARN';
    statusMessage = `Cảnh báo: CSDL toàn vẹn cấu trúc SQLite nhưng metadata thiếu danh sách bảng: ${metaMissingTables.join(', ')} (chưa đối soát đầy đủ)`;
  } else if (!sourceCountsMatch && sourceDbPath) {
    status = 'WARN';
    statusMessage = 'Cảnh báo: Bản sao lưu toàn vẹn nhưng DB nguồn đã có dữ liệu mới ghi sau thời điểm backup';
  }

  const durationMs = Date.now() - startTime;
  console.log('='.repeat(65));
  console.log(`[KẾT LUẬN KIỂM THỬ KHÔI PHỤC: ${status}]`);
  console.log(`- Đánh giá:              ${statusMessage}`);
  console.log(`- Bản sao lưu:           ${backupFile}`);
  console.log(`- Kích thước:            ${formatBytes(fs.statSync(backupFile).size)}`);
  console.log(`- SHA256:                ${currentBackupSha256}`);
  console.log(`- Đối chiếu Metadata:    ${metadataValid ? (metaMissingTables.length === 0 && metaCountMismatches.length === 0 ? 'KHỚP 100%' : 'KHÔNG KHỚP / THIẾU BẢNG') : 'KHÔNG HỢP LỆ (CHƯA XÁC MINH ĐẦY ĐỦ)'}`);
  console.log(`- Tổng thời gian:        ${durationMs} ms`);
  console.log('='.repeat(65));

  if (status === 'FAIL') {
    throw new Error(`Kiểm thử khôi phục THẤT BẠI: ${statusMessage}`);
  }

  return {
    status,
    statusMessage,
    backupFile,
    sha256: currentBackupSha256,
    metadataValid,
    metaChecksumValid,
    metaCountsMatch: metadataValid && metaCountMismatches.length === 0 && metaMissingTables.length === 0,
    structuralIntegrityPass,
    sourceCountsMatch,
    sourceDiscrepancies,
    durationMs,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let backupFile = null;
  let keep = false;
  let dbPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backup' && args[i + 1]) backupFile = args[++i];
    if (args[i] === '--db' && args[i + 1]) dbPath = args[++i];
    if (args[i] === '--keep') keep = true;
  }

  try {
    verifyRestore({ backupFile, keep, dbPath });
  } catch (err) {
    console.error('[LỖI KIỂM THỬ KHÔI PHỤC]:', err.message);
    process.exit(1);
  }
}

module.exports = { verifyRestore };
