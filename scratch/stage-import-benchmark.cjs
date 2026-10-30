const { PrismaClient } = require("../.generated/client");
const XLSX = require("xlsx");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");

function maskCccd(str) {
  if (!str) return "";
  return String(str).replace(/\b(\d{3})\d{3,6}(\d{3})\b/g, "$1***$2");
}

async function main() {
  console.log("=== BẮT ĐẦU ĐO TỪNG GIAI ĐOẠN IMPORT TRÊN BẢN SAO DB ===");

  // 1. Tạo bản sao tạm thời của dev.db trên ổ E: (nơi có 458GB trống)
  const sourceDb = path.resolve("E:/Quản lí/.local/evolution/preview/dev.db");
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, `replica-test-${Date.now()}.db`);
  console.log("Đang sao chép dev.db sang bản sao tạm:", tmpDb);
  fs.copyFileSync(sourceDb, tmpDb);
  console.log("Sao chép thành công. Kích thước bản sao:", (fs.statSync(tmpDb).size / 1024 / 1024).toFixed(2), "MB");

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${tmpDb}` } },
  });

  try {
    const workerCountInit = await prisma.worker.count();
    const bonusCountInit = await prisma.bonusRecord.count();
    console.log(`DB ban đầu có: ${workerCountInit} công nhân, ${bonusCountInit} bản thưởng.`);

    // 2. Đo thời gian đọc và phân tích 2 file Excel
    const fileTongPath = "D:\\Download\\DS_TONG.xlsx";
    const fileThuongPath = "D:\\Download\\DS Thưởng Hoàng - Tú test.xlsx";

    console.log("\n[Giai đoạn 1] Đọc file Excel từ đĩa...");
    const t0 = Date.now();
    const readOptions = { type: "buffer", cellFormula: false, cellHTML: false, cellText: false };
    const bufTong = fs.readFileSync(fileTongPath);
    const bookTong = XLSX.read(bufTong, readOptions);
    const bufThuong = fs.readFileSync(fileThuongPath);
    const bookThuong = XLSX.read(bufThuong, readOptions);
    console.log(`[Giai đoạn 1 Hoàn tất] Đọc 2 file mất: ${Date.now() - t0}ms`);

    // 3. Trích xuất Sheet
    console.log("\n[Giai đoạn 2] Trích xuất dữ liệu Sheet DS_TONG và DS_THUONG...");
    const tExtract = Date.now();
    const sheetTong = bookTong.Sheets["DS_TONG"];
    const matrixTong = XLSX.utils.sheet_to_json(sheetTong, { header: 1, defval: "", blankrows: true });
    console.log(`DS_TONG matrix rows: ${matrixTong.length} (mất ${Date.now() - tExtract}ms)`);

    const sheetThuong = bookThuong.Sheets["DS_THUONG"];
    const matrixThuong = XLSX.utils.sheet_to_json(sheetThuong, { header: 1, defval: "", blankrows: true });
    console.log(`DS_THUONG matrix rows: ${matrixThuong.length} (mất ${Date.now() - tExtract}ms)`);

    // 4. Đo kiểm tra trạng thái các bảng trong DB
    console.log("\n[Giai đoạn 3] Kiểm tra unlinked bonuses trong bản sao DB...");
    const tUb = Date.now();
    const unlinkedBonuses = await prisma.bonusRecord.findMany({
      where: { assignmentId: null, status: "DRAFT", note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
      select: { id: true, workerId: true, company: true, interviewDate: true, workerCode: true, note: true, updatedAt: true },
    });
    console.log(`Tìm thấy ${unlinkedBonuses.length} unlinked bonuses trong DB (mất ${Date.now() - tUb}ms)`);

    // 5. Thử nghiệm đo thời gian cập nhật unlinked bonuses:
    // So sánh: 100 dòng đơn lẻ vs 100 dòng gom batch
    console.log("\n[Giai đoạn 4] Thử nghiệm tốc độ cập nhật linking...");
    const sample = unlinkedBonuses.slice(0, 100);
    
    // Đo tuần tự 100 dòng
    const tSeq0 = Date.now();
    await prisma.$transaction(async (tx) => {
      for (const b of sample) {
        await tx.bonusRecord.updateMany({
          where: { id: b.id, assignmentId: null, status: "DRAFT", updatedAt: b.updatedAt },
          data: { status: "DRAFT" },
        });
      }
      throw new Error("ROLLBACK_BENCHMARK");
    }).catch(e => { if (e.message !== "ROLLBACK_BENCHMARK") throw e; });
    const tSeq = Date.now() - tSeq0;
    console.log(`100 lệnh update đơn lẻ mất: ${tSeq}ms (${(tSeq / 100).toFixed(2)}ms/dòng) -> 60.000 dòng mất ~${((tSeq * 600) / 1000).toFixed(1)} giây!`);

    // Đo batch 100 dòng bằng 1 câu lệnh CASE WHEN
    const tBatch0 = Date.now();
    await prisma.$transaction(async (tx) => {
      const ids = sample.map(s => `'${s.id}'`).join(",");
      const sql = `UPDATE BonusRecord SET status = 'DRAFT' WHERE id IN (${ids}) AND assignmentId IS NULL AND status = 'DRAFT'`;
      await tx.$executeRawUnsafe(sql);
      throw new Error("ROLLBACK_BENCHMARK");
    }).catch(e => { if (e.message !== "ROLLBACK_BENCHMARK") throw e; });
    const tBatch = Date.now() - tBatch0;
    console.log(`100 dòng cập nhật gộp 1 lệnh mất: ${tBatch}ms -> 60.000 dòng mất ~${((tBatch * 600) / 1000).toFixed(2)} giây!`);

  } finally {
    await prisma.$disconnect();
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      const wal = tmpDb + "-wal";
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = tmpDb + "-shm";
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
    console.log("\nĐã dọn dẹp bản sao tạm an toàn.");
  }
}

main().catch(err => {
  console.error("Lỗi:", maskCccd(err.message));
});
