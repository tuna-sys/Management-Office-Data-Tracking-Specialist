const { PrismaClient } = require("../.generated/client");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

async function main() {
  console.log("=== A/B BENCHMARK: TUẦN TỰ (BASELINE) VS PROMISE.ALL (CHUNKING) TRÊN SQLITE ===");

  const sourceDb = path.resolve("E:/Quản lí/.local/evolution/preview/dev.db");
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, `promise-all-ab-${Date.now()}.db`);

  // 1. Tạo bản sao nhất quán bằng VACUUM INTO
  console.log("1. Đang tạo bản sao SQLite nhất quán (VACUUM INTO)...");
  const tVac0 = Date.now();
  const dbSync = new DatabaseSync(sourceDb, { readOnly: true });
  dbSync.exec(`VACUUM INTO '${tmpDb.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  dbSync.close();
  console.log(`   Tạo bản sao hoàn tất (${Date.now() - tVac0}ms), kích thước: ${(fs.statSync(tmpDb).size / 1024 / 1024).toFixed(2)} MB`);

  const prisma = new PrismaClient({ datasources: { db: { url: `file:${tmpDb}` } } });

  try {
    const sampleSize = 500;
    const workers = await prisma.worker.findMany({ take: sampleSize, select: { id: true } });
    assert.strictEqual(workers.length, sampleSize, `Cần ít nhất ${sampleSize} worker để đo`);
    console.log(`2. Lấy mẫu ${workers.length} worker để đo lường đối đầu side-by-side:`);

    // A. BASELINE: Cập nhật tuần tự trong transaction
    console.log("\n--- [Phương án A: Baseline] 500 update TUẦN TỰ trong 1 transaction ---");
    const tSeq0 = Date.now();
    await prisma.$transaction(async (tx) => {
      for (const w of workers) {
        await tx.worker.update({
          where: { id: w.id },
          data: { dob: "01/01/1990" },
        });
      }
      throw new Error("ROLLBACK_BASELINE");
    }).catch(e => {
      if (e.message !== "ROLLBACK_BASELINE") throw e;
    });
    const tSeq = Date.now() - tSeq0;
    console.log(`   Baseline tuần tự: ${tSeq}ms (${(sampleSize / (tSeq / 1000)).toFixed(1)} ops/s)`);

    // B. CANDIDATE: Cập nhật song song theo lô Promise.all (chunk = 50) trong transaction
    console.log("\n--- [Phương án B: Chunked Promise.all] 500 update gom lô CHUNK=50 trong 1 transaction ---");
    const CHUNK_SIZE = 50;
    const tBatch0 = Date.now();
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < workers.length; i += CHUNK_SIZE) {
        const slice = workers.slice(i, i + CHUNK_SIZE);
        await Promise.all(slice.map(w => tx.worker.update({
          where: { id: w.id },
          data: { dob: "01/01/1990" },
        })));
      }
      throw new Error("ROLLBACK_BATCH");
    }).catch(e => {
      if (e.message !== "ROLLBACK_BATCH") throw e;
    });
    const tBatch = Date.now() - tBatch0;
    console.log(`   Chunked Promise.all (chunk=${CHUNK_SIZE}): ${tBatch}ms (${(sampleSize / (tBatch / 1000)).toFixed(1)} ops/s)`);

    // So sánh đối chứng
    const speedup = (tSeq / tBatch).toFixed(2);
    const diffMs = tSeq - tBatch;
    console.log("\n=== KẾT QUẢ ĐỐI SOÁT HIỆU NĂNG ===");
    console.log(`- Baseline (Tuần tự)         : ${tSeq} ms`);
    console.log(`- Tối ưu (Promise.all chunk) : ${tBatch} ms`);
    console.log(`- Chênh lệch thời gian       : Tiết kiệm ${diffMs} ms`);
    console.log(`- Tốc độ cải thiện           : ${speedup}x so với baseline`);

    return { sampleSize, tSeq, tBatch, speedup, diffMs };
  } finally {
    await prisma.$disconnect();
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      const wal = tmpDb + "-wal"; if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = tmpDb + "-shm"; if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
    console.log("\nĐã dọn dẹp bản sao tạm thời an toàn.");
  }
}

main().catch(err => {
  console.error("Lỗi benchmark:", err);
  process.exit(1);
});
