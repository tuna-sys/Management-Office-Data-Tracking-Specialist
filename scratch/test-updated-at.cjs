const { PrismaClient } = require("../.generated/client");
const prisma = new PrismaClient({
  datasources: { db: { url: "file:E:/Quản lí/.local/evolution/preview/dev.db" } }
});

async function main() {
  const ub = await prisma.bonusRecord.findFirst({
    where: { assignmentId: null, status: "DRAFT" },
    select: { id: true, workerId: true, updatedAt: true }
  });
  if (!ub) {
    console.log("No unlinked bonus found");
    return;
  }
  console.log("Found unlinked bonus:", ub.id, "updatedAt:", ub.updatedAt);

  // Test if updateMany with updatedAt matches
  // Using a dummy update (assignmentId: null -> null) inside a transaction that we roll back
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.bonusRecord.updateMany({
        where: { id: ub.id, assignmentId: null, status: "DRAFT", updatedAt: ub.updatedAt },
        data: { status: "DRAFT" }
      });
      console.log("changed.count with updatedAt:", changed.count);
      throw new Error("Rollback intentionally");
    });
  } catch (e) {
    if (e.message !== "Rollback intentionally") console.error("Error:", e);
  }
}

main().finally(() => prisma.$disconnect());
