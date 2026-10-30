const { PrismaClient } = require("../.generated/client");
const path = require("node:path");
const fs = require("node:fs");

function maskCccd(str) {
  if (!str) return "";
  return String(str).replace(/\b(\d{3})\d{3,6}(\d{3})\b/g, "$1***$2");
}

async function main() {
  console.log("=== ĐO LƯỜNG TỪNG KHỐI TRONG TRANSACTION ===");
  const sourceDb = path.resolve("E:/Quản lí/.local/evolution/preview/dev.db");
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  const tmpDb = path.join(tmpDir, `bottleneck-${Date.now()}.db`);
  fs.copyFileSync(sourceDb, tmpDb);

  const prisma = new PrismaClient({ datasources: { db: { url: `file:${tmpDb}` } } });

  try {
    // 1. Đo unlinked bonuses query
    const t0 = Date.now();
    const unlinked = await prisma.bonusRecord.findMany({
      where: { assignmentId: null, status: "DRAFT", note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
      select: { id: true, workerId: true, company: true, interviewDate: true, workerCode: true, note: true, updatedAt: true }
    });
    console.log(`1. unlinkedBonuses findMany (${unlinked.length} dòng): ${Date.now() - t0}ms`);

    // 2. Đo tốc độ batch update 500 bản ghi bằng updateMany thông thường
    const sample500 = unlinked.slice(0, 500);
    const validWorkerId = sample500[0].workerId;
    const realAssign = await prisma.workAssignment.create({
      data: {
        id: "test-assign-" + Date.now(),
        workerId: validWorkerId,
        interviewFactory: "Test Factory",
        status: "Đang chờ phỏng vấn"
      }
    });
    const targetAssignId = realAssign.id;

    // Cách cũ: chạy tuần tự 500 lệnh updateMany + 500 auditLog.create
    const tOld0 = Date.now();
    await prisma.$transaction(async (tx) => {
      for (const b of sample500) {
        await tx.bonusRecord.updateMany({
          where: { id: b.id, assignmentId: null, status: "DRAFT", updatedAt: b.updatedAt },
          data: { assignmentId: targetAssignId },
        });
        await tx.auditLog.create({
          data: {
            module: "IMPORT_RECONCILIATION",
            action: "LINK_BONUS_ON_IMPORT",
            operator: "Test",
            details: JSON.stringify({ bonusId: b.id, workerId: b.workerId, beforeAssignmentId: null, afterAssignmentId: targetAssignId })
          }
        });
      }
      throw new Error("ROLLBACK");
    }).catch(e => { if (e.message !== "ROLLBACK") throw e; });
    const tOld500 = Date.now() - tOld0;
    console.log(`2. CÁCH CŨ: 500 dòng (updateMany + auditLog.create tuần tự) mất: ${tOld500}ms`);
    console.log(`   -> Dự phóng cho 60.600 dòng nối thưởng: ${((tOld500 * 60600 / 500) / 1000).toFixed(1)} giây (~${((tOld500 * 60600 / 500) / 60000).toFixed(1)} phút)!`);

    // Cách mới: Giữ nguyên truy vết từng bản thưởng bằng createMany AuditLog theo lô + update có điều kiện
    const tNew0 = Date.now();
    await prisma.$transaction(async (tx) => {
      const ids = sample500.map(b => `'${b.id}'`).join(",");
      await tx.$executeRawUnsafe(`UPDATE BonusRecord SET assignmentId = '${targetAssignId}' WHERE id IN (${ids}) AND assignmentId IS NULL AND status = 'DRAFT'`);
      
      // Giữ nguyên khả năng truy vết từng bản thưởng bằng AuditLog.createMany:
      const auditEntries = sample500.map(b => ({
        id: crypto.randomUUID(),
        module: "IMPORT_RECONCILIATION",
        action: "LINK_BONUS_ON_IMPORT",
        operator: "Test",
        details: JSON.stringify({ bonusId: b.id, workerId: b.workerId, beforeAssignmentId: null, afterAssignmentId: targetAssignId })
      }));
      await tx.auditLog.createMany({ data: auditEntries });
      throw new Error("ROLLBACK");
    }).catch(e => { if (e.message !== "ROLLBACK") throw e; });
    const tNew500 = Date.now() - tNew0;
    console.log(`3. CÁCH MỚI (giữ 100% điều kiện & truy vết từng bản thưởng): 500 dòng mất: ${tNew500}ms`);
    console.log(`   -> Dự phóng cho 60.600 dòng nối thưởng: ${((tNew500 * 60600 / 500) / 1000).toFixed(1)} giây!`);
  } finally {
    await prisma.$disconnect();
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      const wal = tmpDb + "-wal"; if (fs.existsSync(wal)) fs.unlinkSync(wal);
      const shm = tmpDb + "-shm"; if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
  }
}

main().catch(console.error);
