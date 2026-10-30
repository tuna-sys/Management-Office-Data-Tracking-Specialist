/**
 * tests/sqlite-backup.cjs
 * Bộ kiểm thử tự động cho quy trình sao lưu và kiểm tra khôi phục SQLite.
 * Sử dụng node:test và assert/strict, kiểm thử trên CSDL giả lập trong os.tmpdir().
 * Tuyệt đối không can thiệp CSDL thật của dự án.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

const {
  resolveDatabasePath,
  calculateSha256,
  runSqlitePragmas,
  getTableCounts,
} = require('../scripts/lib/sqlite-backup.cjs');
const { runBackup } = require('../scripts/backup-db.cjs');
const { verifyRestore } = require('../scripts/verify-restore.cjs');

function createFixtureDatabase(dir) {
  const dbPath = path.join(dir, 'fixture-source.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE Worker (
      id TEXT PRIMARY KEY,
      fullName TEXT NOT NULL,
      idCard TEXT NOT NULL
    );
    CREATE TABLE BankAccount (
      id TEXT PRIMARY KEY,
      workerId TEXT NOT NULL,
      accountNumber TEXT NOT NULL
    );
    INSERT INTO Worker (id, fullName, idCard) VALUES ('w1', 'Nguyen Van A', '001000000001');
    INSERT INTO Worker (id, fullName, idCard) VALUES ('w2', 'Tran Thi B', '001000000002');
    INSERT INTO BankAccount (id, workerId, accountNumber) VALUES ('b1', 'w1', '999988887777');
  `);
  db.close();
  return dbPath;
}

test('resolveDatabasePath: fail-fast khi đường dẫn không tồn tại hoặc rỗng', () => {
  assert.throws(
    () => resolveDatabasePath('duong_dan_khong_ton_tai_12345.db'),
    /không tồn tại/,
    'Phải ném lỗi khi đường dẫn DB chỉ định không tồn tại'
  );

  const prevEnv = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.throws(
      () => resolveDatabasePath(null, { envFile: 'non-existent.env' }),
      /chưa được cấu hình|không tồn tại/,
      'Phải ném lỗi khi không tìm thấy DATABASE_URL hợp lệ'
    );

    process.env.DATABASE_URL = 'file:./non-existent-db-999.db';
    assert.throws(
      () => resolveDatabasePath(null),
      /không tồn tại/,
      'Phải ném lỗi khi DATABASE_URL trỏ tới file không tồn tại'
    );
  } finally {
    if (prevEnv) process.env.DATABASE_URL = prevEnv;
    else delete process.env.DATABASE_URL;
  }
});

test('runBackup: sao lưu thành công CSDL giả lập, xuất metadata và checksum khớp', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-test-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');

    const meta = runBackup({
      dbPath: fixtureDbPath,
      outDir: backupDir,
      fileName: 'custom-backup.db',
    });

    assert.ok(fs.existsSync(meta.backupFilePath), 'File backup phải tồn tại');
    assert.ok(fs.existsSync(`${meta.backupFilePath}.meta.json`), 'File metadata phải tồn tại');
    assert.equal(meta.counts.Worker, 2, 'Số lượng Worker phải khớp 2');
    assert.equal(meta.counts.BankAccount, 1, 'Số lượng BankAccount phải khớp 1');

    const directSha256 = calculateSha256(meta.backupFilePath);
    assert.equal(meta.sha256, directSha256, 'SHA256 trong metadata phải khớp file thực tế');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runBackup: xử lý an toàn phần mở rộng tùy biến (custom.sqlite) không ghi đè CSDL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-custom-ext-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');

    const meta = runBackup({
      dbPath: fixtureDbPath,
      outDir: backupDir,
      fileName: 'custom.sqlite',
    });

    assert.equal(meta.backupFileName, 'custom.sqlite');
    assert.ok(fs.existsSync(meta.backupFilePath), 'File custom.sqlite phải tồn tại');
    assert.equal(path.basename(meta.backupFilePath), 'custom.sqlite');

    const metaPath = `${meta.backupFilePath}.meta.json`;
    assert.ok(fs.existsSync(metaPath), 'File custom.sqlite.meta.json phải tồn tại');
    assert.notEqual(metaPath, meta.backupFilePath, 'Đường dẫn metadata không được trùng đường dẫn backup');

    // Mở file custom.sqlite để chắc chắn vẫn là SQLite hợp lệ chứ không bị ghi đè nội dung JSON
    const testDb = new DatabaseSync(meta.backupFilePath, { readOnly: true });
    const row = testDb.prepare('SELECT count(*) as count FROM Worker').get();
    assert.equal(Number(row.count), 2, 'File backup custom.sqlite phải nguyên vẹn CSDL');
    testDb.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveDatabasePath: relative path trong DATABASE_URL tuân thủ quy ước Prisma (prisma/) khi cả 2 DB cùng tồn tại', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-prisma-path-'));
  try {
    const mockRoot = path.join(tmpDir, 'mock-root');
    const mockPrisma = path.join(mockRoot, 'prisma');
    fs.mkdirSync(mockPrisma, { recursive: true });

    // Tạo cả 2 file dev.db: một ở mock root, một ở mock prisma/
    const rootDb = path.join(mockRoot, 'dev.db');
    const prismaDb = path.join(mockPrisma, 'dev.db');
    fs.writeFileSync(rootDb, 'ROOT_DB');
    fs.writeFileSync(prismaDb, 'PRISMA_DB');

    const resolved = resolveDatabasePath(null, {
      dbUrl: 'file:./dev.db',
      schemaDir: mockPrisma,
    });

    assert.equal(resolved, prismaDb, 'Khi cả hai tồn tại, file:./dev.db phải chọn prisma/dev.db');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runBackup: chống ghi đè khi file backup đã tồn tại', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-collision-test-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const existingFile = path.join(backupDir, 'important-backup.db');
    fs.writeFileSync(existingFile, 'DATA_QUAN_TRONG_KHONG_DUOC_XOA', 'utf8');

    // Trường hợp 1: Yêu cầu file cụ thể đã tồn tại -> Phải từ chối ghi đè
    assert.throws(
      () => runBackup({ dbPath: fixtureDbPath, outDir: backupDir, fileName: 'important-backup.db' }),
      /từ chối ghi đè/,
      'Phải ném lỗi từ chối ghi đè khi tên file chỉ định đã tồn tại'
    );
    assert.equal(fs.readFileSync(existingFile, 'utf8'), 'DATA_QUAN_TRONG_KHONG_DUOC_XOA');

    // Trường hợp 2: Tự sinh tên theo timestamp -> Tự đánh số hậu tố, không xóa bản cũ
    const meta1 = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    const meta2 = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    assert.notEqual(meta1.backupFilePath, meta2.backupFilePath, 'Bản sao lưu thứ 2 không được ghi đè bản thứ nhất');
    assert.ok(fs.existsSync(meta1.backupFilePath), 'Bản 1 vẫn phải tồn tại');
    assert.ok(fs.existsSync(meta2.backupFilePath), 'Bản 2 phải tồn tại');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyRestore: khôi phục và xác minh thành công (PASS) trên bản sao độc lập', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-restore-test-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');
    const restoreDir = path.join(tmpDir, 'restore-env');

    const meta = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    const result = verifyRestore({
      backupFile: meta.backupFilePath,
      restoreDir,
      dbPath: fixtureDbPath,
    });

    assert.equal(result.status, 'PASS', 'Kết quả kiểm tra khôi phục phải là PASS');
    assert.equal(result.structuralIntegrityPass, true, 'Kiểm tra cấu trúc SQLite phải đạt');
    assert.equal(result.metaChecksumValid, true, 'SHA256 phải khớp metadata');
    assert.equal(result.metaCountsMatch, true, 'Số lượng bản ghi phải khớp metadata');
    assert.equal(result.sourceCountsMatch, true, 'Số lượng bản ghi phải khớp DB nguồn');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyRestore: metadata sai định dạng (thiếu counts, counts là array, số âm, sha256 sai) trả về WARN', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-invalid-meta-test-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');
    const restoreDir = path.join(tmpDir, 'restore-env');

    const meta = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    const metaFile = `${meta.backupFilePath}.meta.json`;

    // Case 1: Thiếu trường counts
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: meta.sha256 }));
    let res = verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath });
    assert.equal(res.status, 'WARN');
    assert.equal(res.metaCountsMatch, false);

    // Case 2: counts là array
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: meta.sha256, counts: [1, 2] }));
    res = verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath });
    assert.equal(res.status, 'WARN');

    // Case 3: counts có số âm
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: meta.sha256, counts: { Worker: -1 } }));
    res = verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath });
    assert.equal(res.status, 'WARN');

    // Case 4: sha256 không đúng định dạng 64 ký tự hex
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: 'not-a-64-hex', counts: { Worker: 2 } }));
    res = verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath });
    assert.equal(res.status, 'WARN');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyRestore: metadata thiếu bảng so với CSDL khôi phục trả về WARN (chưa đối soát đầy đủ)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-missing-table-meta-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');
    const restoreDir = path.join(tmpDir, 'restore-env');

    const meta = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    const metaFile = `${meta.backupFilePath}.meta.json`;

    // CSDL có Worker và BankAccount, nhưng metadata chỉ có Worker
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: meta.sha256, counts: { Worker: 2 } }));

    const res = verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath });
    assert.equal(res.status, 'WARN', 'Thiếu bảng trong metadata phải trả về WARN');
    assert.match(res.statusMessage, /thiếu danh sách bảng/, 'Thông báo phải nêu rõ thiếu bảng');
    assert.equal(res.metaCountsMatch, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyRestore: metadata chuẩn nhưng số lượng bản ghi lệch trả về FAIL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-count-mismatch-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');
    const restoreDir = path.join(tmpDir, 'restore-env');

    const meta = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    const metaFile = `${meta.backupFilePath}.meta.json`;

    // Metadata chuẩn, checksum khớp, nhưng số lượng Worker bị khai khống
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: meta.sha256, counts: { Worker: 999, BankAccount: 1 } }));

    assert.throws(
      () => verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath }),
      /Kiểm thử khôi phục THẤT BẠI.*sai lệch so với metadata/,
      'Lệch số lượng bản ghi so với metadata bắt buộc phải ném lỗi FAIL'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyRestore: sai checksum SHA256 ném lỗi trước khi tạo thư mục tạm (không để lại rác)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-no-leak-checksum-'));
  try {
    const fixtureDbPath = createFixtureDatabase(tmpDir);
    const backupDir = path.join(tmpDir, 'backups');
    const restoreDir = path.join(tmpDir, 'restore-env');
    fs.mkdirSync(restoreDir, { recursive: true });

    const meta = runBackup({ dbPath: fixtureDbPath, outDir: backupDir });
    const metaFile = `${meta.backupFilePath}.meta.json`;

    // Metadata hợp lệ về cấu trúc nhưng checksum không khớp file backup
    const fakeChecksum = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    fs.writeFileSync(metaFile, JSON.stringify({ sha256: fakeChecksum, counts: { Worker: 2, BankAccount: 1 } }));

    assert.throws(
      () => verifyRestore({ backupFile: meta.backupFilePath, restoreDir, dbPath: fixtureDbPath }),
      /sai checksum SHA256/,
      'Phải ném lỗi khi checksum không khớp'
    );

    // Xác minh thư mục restoreDir của bài test hoàn toàn không có thư mục run-* nào
    const remaining = fs.readdirSync(restoreDir);
    assert.equal(remaining.length, 0, 'Không được tạo hoặc để lại thư mục tạm khi sai checksum');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verifyRestore: tự động dọn dẹp thư mục tạm trong finally ngay cả khi gặp lỗi', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-finally-cleanup-'));
  try {
    const restoreDir = path.join(tmpDir, 'restore-env');
    fs.mkdirSync(restoreDir, { recursive: true });

    // Tạo file rác giả lập backup bị hỏng nặng
    const badBackupFile = path.join(tmpDir, 'bad-backup.db');
    fs.writeFileSync(badBackupFile, 'NOT_A_SQLITE_DATABASE');
    const badMeta = `${badBackupFile}.meta.json`;
    fs.writeFileSync(badMeta, JSON.stringify({
      sha256: calculateSha256(badBackupFile),
      counts: { Worker: 1 },
    }));

    assert.throws(
      () => verifyRestore({ backupFile: badBackupFile, restoreDir }),
      /file is not a database|Kiểm thử khôi phục THẤT BẠI/,
      'Phải ném lỗi khi file không phải CSDL SQLite'
    );

    // Kiểm tra xem các thư mục tạm bên trong restoreDir đã được dọn sạch chưa
    const remaining = fs.readdirSync(restoreDir);
    assert.equal(remaining.length, 0, 'Thư mục tạm phải được dọn dẹp sạch sẽ trong finally');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
