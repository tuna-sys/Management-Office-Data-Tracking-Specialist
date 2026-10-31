/**
 * scripts/backup-db.cjs
 * Sao lưu an toàn, nhất quán cơ sở dữ liệu SQLite trong khi ứng dụng đang chạy.
 * Cơ chế: SQLite VACUUM INTO qua node:sqlite (readOnly mode).
 * 
 * Điểm an toàn:
 *  - Sao lưu online qua lệnh SQLite VACUUM INTO (readOnly mode).
 *  - Với CSDL ở chế độ delete journal, thao tác ghi đồng thời có thể phải chờ ngắn; khuyến nghị sao lưu lúc ít tải.
 *  - Không sửa đổi schema hay dữ liệu DB nguồn.
 *  - Fail-fast khi DATABASE_URL không rõ ràng, không fallback ngầm định.
 *  - Chống ghi đè (từ chối đè file có trước; tự động tăng số thứ tự nếu trùng timestamp).
 *  - Xuất metadata chuẩn (<backup>.meta.json) kèm SHA256 để phục vụ đối soát khôi phục.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  resolveDatabasePath,
  calculateSha256,
  formatBytes,
  openSqliteReadOnly,
  getUserTables,
  getTableCounts,
  getMetaFilePath,
} = require('./lib/sqlite-backup.cjs');

function getSafeBackupFilePath(backupDir, requestedFileName) {
  if (requestedFileName) {
    const target = path.join(backupDir, requestedFileName);
    if (fs.existsSync(target)) {
      throw new Error(`File sao lưu chỉ định đã tồn tại trên đĩa, từ chối ghi đè: ${target}`);
    }
    return target;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const baseName = `backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  let candidate = path.join(backupDir, `${baseName}.db`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(backupDir, `${baseName}_${counter}.db`);
    counter++;
  }
  return candidate;
}

function runBackup(options = {}) {
  const startTime = Date.now();
  const sourceDbPath = resolveDatabasePath(options.dbPath);

  const backupDir = path.resolve(options.outDir || '.local/backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const backupFilePath = getSafeBackupFilePath(backupDir, options.fileName);
  const backupFileName = path.basename(backupFilePath);

  console.log('='.repeat(65));
  console.log('[BACKUP] Bắt đầu sao lưu SQLite nhất quán (Online Backup)');
  console.log(`- Nguồn DB:      ${sourceDbPath}`);
  console.log(`- Đích sao lưu:  ${backupFilePath}`);
  console.log('='.repeat(65));

  // Mở DB nguồn ở chế độ readOnly để đảm bảo zero mutation
  const sourceDb = openSqliteReadOnly(sourceDbPath);
  let coreTables = [];
  try {
    coreTables = getUserTables(sourceDb);
    // VACUUM INTO tạo bản sao lưu độc lập, bao gồm cả các transaction trong WAL
    const normalizedTarget = backupFilePath.replace(/\\/g, '/').replace(/'/g, "''");
    sourceDb.exec(`VACUUM INTO '${normalizedTarget}'`);
  } finally {
    sourceDb.close();
  }

  if (!fs.existsSync(backupFilePath)) {
    throw new Error('Sao lưu thất bại: File sao lưu không được tạo.');
  }

  const stats = fs.statSync(backupFilePath);
  const sha256 = calculateSha256(backupFilePath);

  // Mở file backup vừa tạo để kiểm tra và lấy số lượng bản ghi lưu vào metadata
  const backupDb = openSqliteReadOnly(backupFilePath);
  let counts = {};
  try {
    counts = getTableCounts(backupDb, coreTables);
  } finally {
    backupDb.close();
  }

  const durationMs = Date.now() - startTime;
  const meta = {
    sourceDbPath,
    backupFilePath,
    backupFileName,
    createdAt: new Date().toISOString(),
    sizeBytes: stats.size,
    sizeFormatted: formatBytes(stats.size),
    sha256,
    counts,
    durationMs,
  };

  const metaFilePath = getMetaFilePath(backupFilePath);
  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), 'utf8');

  console.log('[BACKUP THÀNH CÔNG]');
  console.log(`- Kích thước:    ${formatBytes(stats.size)} (${stats.size} bytes)`);
  console.log(`- SHA256:        ${sha256}`);
  console.log(`- Thời gian:     ${durationMs} ms`);
  console.log(`- Số lượng bản ghi chính:`);
  const highlightTables = ['Worker', 'WorkAssignment', 'BonusRecord', 'BankAccount', 'AuditLog'];
  for (const table of highlightTables) {
    if (counts[table] !== undefined) {
      console.log(`    + ${table.padEnd(16)}: ${counts[table]}`);
    }
  }
  console.log(`- File metadata: ${metaFilePath}`);
  console.log('='.repeat(65));

  return meta;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let dbPath = null;
  let outDir = null;
  let fileName = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) dbPath = args[++i];
    if (args[i] === '--out' && args[i + 1]) outDir = args[++i];
    if (args[i] === '--file' && args[i + 1]) fileName = args[++i];
  }

  try {
    runBackup({ dbPath, outDir, fileName });
  } catch (error) {
    console.error('[LỖI SAO LƯU]:', error.message);
    process.exit(1);
  }
}

module.exports = { runBackup };
