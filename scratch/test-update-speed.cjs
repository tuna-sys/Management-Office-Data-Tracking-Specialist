const { PrismaClient } = require("../.generated/client");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

async function main() {
  const tmpDb = path.join(os.tmpdir(), `bench-upd-${Date.now()}.db`);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${tmpDb}` } } });

  try {
    const { execSync } = require("node:child_process");
    execSync(`npx prisma db push --schema=prisma/schema.prisma --accept-data-loss`, {
      env: { ...process.env, DATABASE_URL: `file:${tmpDb}` },
      stdio: "ignore"
    });

    const N = 5000;
    const workers = [];
    for (let i = 0; i < N; i++) {
      workers.push({ id: `w-${i}`, idCard: `001099${String(i).padStart(6, "0")}`, fullName: `Name ${i}` });
    }
    await prisma.worker.createMany({ data: workers });
    console.log(`Created ${N} workers.`);

    // Approach 1: Sequential prisma.worker.update inside transaction
    const t0 = Date.now();
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 500; i++) {
        await tx.worker.update({
          where: { id: `w-${i}` },
          data: { phone: `0900000${i}`, dob: "2000-01-01", address: "Hanoi" }
        });
      }
    });
    const t1 = Date.now();
    console.log(`Prisma individual update 500 rows: ${t1 - t0}ms (${((t1 - t0) / 500).toFixed(2)}ms/row)`);

    // Approach 2: Using tx.$executeRawUnsafe with CASE WHEN or multi-statement inside transaction
    const t2 = Date.now();
    await prisma.$transaction(async (tx) => {
      // Chunk of 500 using CASE WHEN in a single SQL statement!
      const chunk = [];
      for (let i = 500; i < 1000; i++) {
        chunk.push({ id: `w-${i}`, phone: `0900000${i}`, dob: "2000-01-01", address: "Hanoi" });
      }
      const ids = chunk.map(c => `'${c.id}'`).join(",");
      const phoneCase = chunk.map(c => `WHEN '${c.id}' THEN '${c.phone}'`).join(" ");
      const dobCase = chunk.map(c => `WHEN '${c.id}' THEN '${c.dob}'`).join(" ");
      const addrCase = chunk.map(c => `WHEN '${c.id}' THEN '${c.address}'`).join(" ");
      const sql = `UPDATE Worker SET phone = CASE id ${phoneCase} END, dob = CASE id ${dobCase} END, address = CASE id ${addrCase} END WHERE id IN (${ids})`;
      await tx.$executeRawUnsafe(sql);
    });
    const t3 = Date.now();
    console.log(`CASE WHEN bulk update 500 rows in 1 query: ${t3 - t2}ms!`);

  } finally {
    await prisma.$disconnect();
    try { fs.unlinkSync(tmpDb); } catch {}
  }
}

main().catch(console.error);
