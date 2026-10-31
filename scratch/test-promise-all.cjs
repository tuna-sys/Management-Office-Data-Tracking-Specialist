const { PrismaClient } = require("../.generated/client");
const path = require("node:path");
const fs = require("node:fs");

async function main() {
  const tmpDir = path.resolve("E:/Quản lí/.local/benchmark-temp");
  const tmpDb = path.join(tmpDir, `promise-all-${Date.now()}.db`);
  fs.copyFileSync(path.resolve("E:/Quản lí/.local/evolution/preview/dev.db"), tmpDb);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${tmpDb}` } } });

  try {
    const workers = await prisma.worker.findMany({ take: 500, select: { id: true } });
    console.log("Benchmarking 500 updates sequentially vs Promise.all in SQLite transaction...");

    // Test Promise.all in chunks of 50
    const t0 = Date.now();
    await prisma.$transaction(async (tx) => {
      const CHUNK = 50;
      for (let i = 0; i < workers.length; i += CHUNK) {
        const slice = workers.slice(i, i + CHUNK);
        await Promise.all(slice.map(w => tx.worker.update({
          where: { id: w.id },
          data: { dob: "01/01/2000" }
        })));
      }
      throw new Error("ROLLBACK");
    }).catch(e => { if (e.message !== "ROLLBACK") throw e; });
    console.log(`Promise.all in chunks of 50 took: ${Date.now() - t0}ms for 500 rows`);
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
