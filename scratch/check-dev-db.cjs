const { PrismaClient } = require("../.generated/client");
const prisma = new PrismaClient({
  datasources: { db: { url: "file:E:/Quản lí/.local/evolution/preview/dev.db" } }
});

async function main() {
  const statuses = await prisma.laborStatus.findMany();
  console.log("LaborStatuses in dev.db:", statuses.map(s => s.name));
  const workerCount = await prisma.worker.count();
  const assignmentCount = await prisma.workAssignment.count();
  const bonusCount = await prisma.bonusRecord.count();
  const auditLogs = await prisma.auditLog.findMany({ take: 5, orderBy: { createdAt: "desc" } });
  console.log({ workerCount, assignmentCount, bonusCount, auditLogs });
}

main().finally(() => prisma.$disconnect());
