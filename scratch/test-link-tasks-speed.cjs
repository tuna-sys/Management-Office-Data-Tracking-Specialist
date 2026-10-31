const { PrismaClient } = require("../.generated/client");
const prisma = new PrismaClient({
  datasources: { db: { url: "file:E:/Quản lí/.local/evolution/preview/dev.db" } }
});

async function main() {
  const t0 = Date.now();
  console.log("Querying unlinked bonuses from dev.db...");
  const unlinkedBonuses = await prisma.bonusRecord.findMany({
    where: { assignmentId: null, status: "DRAFT", note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
    select: { id: true, workerId: true, company: true, interviewDate: true, workerCode: true, note: true, updatedAt: true },
  });
  console.log(`Found ${unlinkedBonuses.length} unlinked bonuses in ${Date.now() - t0}ms`);

  // Let's measure how long it takes to run 1,000 tx.bonusRecord.updateMany + tx.auditLog.create in SQLite
  // to extrapolate to 60,000!
  console.log("Benchmarking 100 individual updates + auditLog creates inside transaction...");
  const t1 = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 100; i++) {
        const ub = unlinkedBonuses[i];
        await tx.bonusRecord.updateMany({
          where: { id: ub.id, assignmentId: null, status: "DRAFT", updatedAt: ub.updatedAt },
          data: { status: "DRAFT" },
        });
        await tx.auditLog.create({
          data: {
            module: "IMPORT_RECONCILIATION",
            action: "LINK_BONUS_ON_IMPORT",
            operator: "Benchmark",
            details: JSON.stringify({ bonusId: ub.id, workerId: ub.workerId, beforeAssignmentId: null, afterAssignmentId: "dummy" }),
          },
        });
      }
      throw new Error("Rollback benchmark");
    });
  } catch (e) {
    if (e.message !== "Rollback benchmark") throw e;
  }
  const t2 = Date.now();
  const perItem = (t2 - t1) / 100;
  console.log(`100 items took ${t2 - t1}ms (${perItem.toFixed(2)}ms per item)`);
  console.log(`Projected time for 60,000 items: ${((60000 * perItem) / 1000).toFixed(1)} seconds (${((60000 * perItem) / 60000).toFixed(1)} minutes)`);
}

main().finally(() => prisma.$disconnect());
