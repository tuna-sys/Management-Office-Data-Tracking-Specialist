const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { resolveDatabasePath } = require("./lib/sqlite-backup.cjs");

const sourceDir = path.resolve(process.env.LOCAL_IMPORT_SOURCE_DIR || ".local/source-imports");
const dbPath = resolveDatabasePath();
if (!fs.existsSync(sourceDir)) throw new Error(`Không tìm thấy thư mục snapshot: ${sourceDir}`);
const files = fs.readdirSync(sourceDir).filter((name) => /^[a-f0-9-]+\.json$/i.test(name)).sort();
const resolvedPath = path.resolve(process.env.LOCAL_RESOLVED_DUPLICATES || ".local/resolved-duplicates.json");
const resolvedIds = new Set();
if (fs.existsSync(resolvedPath)) {
  const stored = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const ids = Array.isArray(stored) ? stored : Array.isArray(stored?.ids) ? stored.ids : Object.keys(stored || {});
  for (const id of ids) if (typeof id === "string") resolvedIds.add(id);
}
function classifyKind(message, fallback) {
  const text = String(message || "");
  if (!/Trùng SĐT|Trùng lặp nội bộ|Trùng ngày PV tại hai công ty|Khác mã theo công ty|Sai lệch danh tính|Lượt PV đã được người khác thêm|lượt.*đã có|STK trùng|Bản thưởng của đợt đã có|CHƯA BÁO NGHỈ|CẦN QUẢN LÝ XÁC NHẬN|nhảy sang|Danh sách đen|DS Đen/i.test(text)) {
    return /SĐT/i.test(text) ? "PHONE_NOTICE" : "DATA_WARNING";
  }
  if (/Danh sách đen|DS Đen/i.test(text)) return "BLACKLIST";
  if (/Trùng SĐT/i.test(text)) return "PHONE";
  if (/CHƯA BÁO NGHỈ|CẦN QUẢN LÝ XÁC NHẬN|nhảy sang/i.test(text)) return "CROSS_COMPANY";
  if (/STK|tài khoản/i.test(text)) return "BANK_ACCOUNT";
  if (/Sai lệch danh tính/i.test(text)) return "IDENTITY_MISMATCH";
  if (/thưởng/i.test(text)) return "BONUS";
  return fallback === "DUPLICATE" ? "INTERNAL_DUPLICATE" : fallback;
}
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
const insertBatch = db.prepare(`INSERT OR IGNORE INTO ImportBatch(id,type,file,sheet,createdAt) VALUES(?,?,?,?,?)`);
const insertRow = db.prepare(`INSERT OR IGNORE INTO ImportSourceRow(id,sourceId,rowNumber,valuesJson,warningsJson,duplicatesJson,isApproved,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`);
const insertIssue = db.prepare(`INSERT OR IGNORE INTO DataIssue(id,sourceRowId,kind,message,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)`);
const sourceRowId = (sourceId, row) => `${sourceId}:${Number(row)}`;
const issueId = (rowId, kind, message, index) => crypto.createHash("sha256").update(`${rowId}\0${kind}\0${index}\0${message}`).digest("hex");
let sourceCount = 0, expectedRows = 0, insertedRows = 0, expectedIssues = 0, expectedWarnings = 0, expectedDuplicates = 0;
try {
  db.exec("BEGIN IMMEDIATE;");
  for (const name of files) {
    const data = JSON.parse(fs.readFileSync(path.join(sourceDir, name), "utf8"));
    if (!data?.id || data.id !== name.slice(0, -5) || !Array.isArray(data.rows))
      throw new Error(`Snapshot không hợp lệ: ${name}`);
    const createdAt = data.createdAt || new Date(0).toISOString();
    insertBatch.run(data.id, data.type || "UNKNOWN", data.file || name, data.sheet || "", createdAt);
    sourceCount++;
    for (const row of data.rows) {
      const rowId = sourceRowId(data.id, row.row);
      const warnings = Array.isArray(row.warnings) ? row.warnings : [];
      const duplicates = Array.isArray(row.duplicates) ? row.duplicates : [];
      expectedWarnings += warnings.length;
      expectedDuplicates += duplicates.length;
      const rowCreatedAt = row.createdAt || createdAt;
      const approved = row.isApproved || resolvedIds.has(`import-${data.id}-${row.row}`);
      const result = insertRow.run(rowId, data.id, Number(row.row), JSON.stringify(row.values || {}), JSON.stringify(warnings), JSON.stringify(duplicates), approved ? 1 : 0, rowCreatedAt, row.updatedAt || rowCreatedAt);
      expectedRows++;
      insertedRows += Number(result.changes || 0);
      for (const [kind, messages] of [["WARNING", warnings], ["DUPLICATE", duplicates]]) {
        for (let i = 0; i < messages.length; i++) {
          const message = String(messages[i] ?? "");
          insertIssue.run(issueId(rowId, kind, message, i), rowId, classifyKind(message, kind), message, approved ? "RESOLVED" : "OPEN", rowCreatedAt, row.updatedAt || rowCreatedAt);
          expectedIssues++;
        }
      }
    }
  }
  const dbRows = db.prepare("SELECT COUNT(*) AS n FROM ImportSourceRow").get().n;
  const dbBatches = db.prepare("SELECT COUNT(*) AS n FROM ImportBatch").get().n;
  const dbIssues = db.prepare("SELECT COUNT(*) AS n FROM DataIssue").get().n;
  if (dbRows !== expectedRows || dbBatches !== sourceCount || dbIssues !== expectedIssues)
    throw new Error(`Đối chiếu không khớp: expected batches/rows/issues=${sourceCount}/${expectedRows}/${expectedIssues}; DB=${dbBatches}/${dbRows}/${dbIssues}`);
  db.exec("COMMIT;");
  console.log(JSON.stringify({ database: dbPath, sourceDir, files: files.length, batches: sourceCount, rows: dbRows, warnings: expectedWarnings, duplicates: expectedDuplicates, issues: dbIssues, newlyInsertedRows: insertedRows, status: "BACKFILL_VERIFIED" }, null, 2));
} catch (error) {
  try { db.exec("ROLLBACK;"); } catch {}
  throw error;
} finally {
  db.close();
}
