/**
 * scripts/lib/sqlite-backup.cjs
 * Thư viện tiện ích dùng chung cho tác vụ sao lưu và kiểm tra khôi phục CSDL SQLite.
 * Sử dụng thuần Node.js 24 (node:sqlite, node:fs, node:crypto), không phụ thuộc bên ngoài.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/**
 * Phân giải đường dẫn SQLite nghiêm ngặt (Fail-Fast):
 * 1. Ưu tiên tham số truyền vào explicit (--db).
 * 2. Tiếp theo lấy từ biến môi trường DATABASE_URL.
 * 3. Nếu chưa có, đọc file .env ở thư mục gốc.
 * Tuyệt đối không fallback ngầm định sang các đường dẫn không xác định.
 */
function resolveDatabasePath(customPath, options = {}) {
  // 1. Tham số chỉ định trực tiếp (--db): đường dẫn tương đối tính từ thư mục chạy lệnh (process.cwd())
  if (customPath) {
    const resolved = path.resolve(customPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Đường dẫn CSDL chỉ định (--db) không tồn tại: ${resolved}`);
    }
    return resolved;
  }

  // 2. Lấy cấu hình từ biến môi trường DATABASE_URL hoặc file .env (hoặc options.dbUrl trong test)
  const envFile = options.envFile || '.env';
  let dbUrl = options.dbUrl || process.env.DATABASE_URL;
  if (!dbUrl && fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    const match = envContent.match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?/m);
    if (match) {
      dbUrl = match[1];
    }
  }

  if (!dbUrl || !dbUrl.trim()) {
    throw new Error('DATABASE_URL chưa được cấu hình trong môi trường hoặc file .env');
  }

  let clean = dbUrl.trim();
  if (clean.startsWith('file:')) {
    clean = clean.slice(5).split('?')[0];
  }
  clean = decodeURIComponent(clean);

  // Quy ước Prisma: đường dẫn tương đối trong DATABASE_URL luôn tính từ thư mục chứa schema (prisma/)
  const schemaDir = options.schemaDir ? path.resolve(options.schemaDir) : path.resolve('prisma');
  const resolved = path.isAbsolute(clean)
    ? path.normalize(clean)
    : path.resolve(schemaDir, clean);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File CSDL từ DATABASE_URL không tồn tại: ${resolved}`);
  }

  return resolved;
}

/**
 * Sinh đường dẫn file metadata chuẩn, luôn nối đuôi .meta.json để tuyệt đối không trùng tên file backup
 */
function getMetaFilePath(backupFilePath) {
  return `${backupFilePath}.meta.json`;
}

/**
 * Tìm file metadata tương ứng với bản backup (ưu tiên <backup>.meta.json, hỗ trợ định dạng cũ <backup-không-đuôi-db>.meta.json)
 */
function findMetaFilePath(backupFilePath) {
  const standardPath = getMetaFilePath(backupFilePath);
  if (fs.existsSync(standardPath)) return standardPath;

  const legacyPath = backupFilePath.replace(/\.db$/, '.meta.json');
  if (legacyPath !== backupFilePath && fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return null;
}

/**
 * Tính mã băm SHA256 của file
 */
function calculateSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Không tìm thấy file để tính checksum: ${filePath}`);
  }
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * Định dạng dung lượng bytes sang chuỗi dễ đọc
 */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Mở kết nối SQLite ở chế độ readOnly an toàn
 */
function openSqliteReadOnly(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`File SQLite không tồn tại: ${dbPath}`);
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * Chạy các lệnh kiểm tra cấu trúc chuẩn của SQLite (PRAGMA)
 */
function runSqlitePragmas(db) {
  const integrityRes = db.prepare('PRAGMA integrity_check').all();
  const integrityOk = integrityRes.length === 1 && integrityRes[0].integrity_check === 'ok';

  const quickRes = db.prepare('PRAGMA quick_check').all();
  const quickCheckOk = quickRes.length === 1 && quickRes[0].quick_check === 'ok';

  const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();

  return {
    integrityOk,
    quickCheckOk,
    foreignKeyOk: foreignKeyErrors.length === 0,
    foreignKeyErrors,
    details: {
      integrityRes,
      quickRes,
      foreignKeyErrors,
    },
  };
}

/**
 * Lấy danh sách toàn bộ các bảng người dùng trong CSDL
 */
function getUserTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name ASC")
    .all()
    .map((r) => r.name);
}

/**
 * Thống kê số lượng bản ghi của danh sách các bảng
 */
function getTableCounts(db, tableNames) {
  const counts = {};
  for (const table of tableNames) {
    try {
      const row = db.prepare(`SELECT count(*) as count FROM "${table}"`).get();
      counts[table] = row ? Number(row.count) : 0;
    } catch {
      counts[table] = -1; // lỗi hoặc bảng không hợp lệ
    }
  }
  return counts;
}

module.exports = {
  resolveDatabasePath,
  calculateSha256,
  formatBytes,
  openSqliteReadOnly,
  runSqlitePragmas,
  getUserTables,
  getTableCounts,
  getMetaFilePath,
  findMetaFilePath,
};
