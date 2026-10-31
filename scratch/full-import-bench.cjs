const { PrismaClient } = require("../.generated/client");
const XLSX = require("xlsx");
const path = require("node:path");
const fs = require("node:fs");

function maskCccd(str) {
  if (!str) return "";
  return String(str).replace(/\b(\d{3})\d{3,6}(\d{3})\b/g, "$1***$2");
}

async function run() {
  console.log("=== BẮT ĐẦU CHẠY THỬ IMPORT ĐẦY ĐỦ TRÊN BẢN SAO DB (Ổ E:) ===");

  const sourceDb = path.resolve("E:/Quản lí/.local/evolution/preview/dev.db");
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, `full-bench-${Date.now()}.db`);
  console.log("Đang sao chép dev.db sang:", tmpDb);
  fs.copyFileSync(sourceDb, tmpDb);

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${tmpDb}` } },
  });

  try {
    const fileTongPath = "D:\\Download\\DS_TONG.xlsx";
    const fileThuongPath = "D:\\Download\\DS Thưởng Hoàng - Tú test.xlsx";

    console.log("Đang nạp 2 file Excel...");
    const t0 = Date.now();
    const readOptions = { type: "buffer", cellFormula: false, cellHTML: false, cellText: false };
    const bookTong = XLSX.read(fs.readFileSync(fileTongPath), readOptions);
    const bookThuong = XLSX.read(fs.readFileSync(fileThuongPath), readOptions);
    console.log(`Đã đọc 2 file xong (${Date.now() - t0}ms)`);

    // Ghép sheet giống route.ts
    const book = bookTong;
    for (const sName of bookThuong.SheetNames) {
      let targetSheetName = sName;
      if (book.Sheets[targetSheetName]) targetSheetName = `${sName}_2`;
      book.SheetNames.push(targetSheetName);
      book.Sheets[targetSheetName] = bookThuong.Sheets[sName];
    }

    // Nạp route.ts logic để chạy trực tiếp với transaction
    // Ta import trực tiếp hàm execute bên trong transaction của Prisma
    console.log("Chuẩn bị chạy import trong Prisma transaction...");

    const tTx0 = Date.now();
    await prisma.$transaction(async (tx) => {
      // 1. Kiểm tra existing trong DB
      const tEx = Date.now();
      const existing = await tx.worker.findMany({ include: { assignments: true, bankAccounts: true } });
      console.log(`[Đo lường] tx.worker.findMany lấy ${existing.length} công nhân: ${Date.now() - tEx}ms`);

      const unlinked = await tx.bonusRecord.findMany({
        where: { assignmentId: null, status: "DRAFT", note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
        select: { id: true, workerId: true, company: true, interviewDate: true, workerCode: true, note: true, updatedAt: true }
      });
      console.log(`[Đo lường] tx.bonusRecord.findMany lấy ${unlinked.length} bản thưởng: ${Date.now() - tEx}ms`);

      // Rollback sau khi đo xong
      throw new Error("ROLLBACK_AFTER_MEASUREMENT");
    }, { timeout: 600000 }).catch(e => {
      if (e.message !== "ROLLBACK_AFTER_MEASUREMENT") throw e;
    });

    console.log(`Tổng thời gian giao dịch thử nghiệm: ${Date.now() - tTx0}ms`);
  } catch (err) {
    console.error("Lỗi:", maskCccd(err.stack || err.message));
  } finally {
    await prisma.$disconnect();
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      const wal = tmpDb + "-wal"; if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = tmpDb + "-shm"; if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
    console.log("Đã dọn dẹp bản sao tạm an toàn.");
  }
}

run();
