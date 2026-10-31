const { PrismaClient } = require("../.generated/client");
const prisma = new PrismaClient({
  datasources: { db: { url: "file:E:/Quản lí/.local/evolution/preview/dev.db" } }
});

async function main() {
  const workers = await prisma.worker.findMany({
    select: { id: true, idCard: true, code: true, dob: true, gender: true, phone: true, address: true, province: true, recruiter: true, team: true, source: true, idCardDate: true, idCardPlace: true }
  });
  console.log("Total workers in dev.db:", workers.length);
  const emptyDob = workers.filter(w => !w.dob).length;
  const emptyPhone = workers.filter(w => !w.phone).length;
  const emptyAddress = workers.filter(w => !w.address).length;
  console.log({ emptyDob, emptyPhone, emptyAddress });
}

main().finally(() => prisma.$disconnect());
