const { PrismaClient } = require("../.generated/client");
const prisma = new PrismaClient({
  datasources: { db: { url: "file:E:/Quản lí/.local/evolution/preview/dev.db" } }
});

async function main() {
  const bonuses = await prisma.bonusRecord.findMany({
    where: { assignmentId: null, status: "DRAFT", note: { contains: "SOURCE_EXCEL_ACTUAL_PAID" } },
    select: { id: true, workerId: true, company: true, interviewDate: true, workerCode: true, updatedAt: true }
  });
  console.log("Total matching bonuses:", bonuses.length);
  const ids = new Set(bonuses.map(b => b.id));
  console.log("Unique IDs count:", ids.size);
}

main().finally(() => prisma.$disconnect());
