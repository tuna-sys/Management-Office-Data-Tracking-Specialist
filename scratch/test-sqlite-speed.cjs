const { PrismaClient } = require("../.generated/client");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

async function main() {
  const tmpDb = path.join(os.tmpdir(), `bench-${Date.now()}.db`);
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${tmpDb}` } },
    log: ["error"]
  });

  try {
    const { execSync } = require("node:child_process");
    execSync(`npx prisma db push --schema=prisma/schema.prisma --accept-data-loss`, {
      env: { ...process.env, DATABASE_URL: `file:${tmpDb}` },
      stdio: "ignore"
    });

    console.log("Schema initialized on", tmpDb);

    const N = 50000;
    const workers = [];
    const assignments = [];
    const events = [];

    for (let i = 0; i < N; i++) {
      const wid = `w-${i}`;
      workers.push({
        id: wid,
        idCard: `001099${String(i).padStart(6, "0")}`,
        fullName: `Nguyen Van ${i}`,
      });
      const aid = `a-${i}`;
      assignments.push({
        id: aid,
        workerId: wid,
        interviewFactory: "Luxshare",
        status: "Đang chờ phỏng vấn",
      });
      events.push({
        id: `e-${i}`,
        assignmentId: aid,
        occurredOn: "2026-10-30",
        toStatus: "Đang chờ phỏng vấn",
        operator: "Admin",
      });
    }

    console.log("Generated test data in memory. Now executing transaction...");
    const t0 = Date.now();
    await prisma.$transaction(async (tx) => {
      const CHUNK = 500;
      for (let i = 0; i < workers.length; i += CHUNK) {
        await tx.worker.createMany({ data: workers.slice(i, i + CHUNK) });
      }
      for (let i = 0; i < assignments.length; i += CHUNK) {
        await tx.workAssignment.createMany({ data: assignments.slice(i, i + CHUNK) });
      }
      for (let i = 0; i < events.length; i += CHUNK) {
        await tx.assignmentEvent.createMany({ data: events.slice(i, i + CHUNK) });
      }
    }, { timeout: 600000 });
    const t1 = Date.now();
    console.log(`Inserted 50,000 workers + 50,000 assignments + 50,000 events in ${t1 - t0}ms`);
  } catch (err) {
    console.error("Benchmark error:", err);
  } finally {
    await prisma.$disconnect();
    try { fs.unlinkSync(tmpDb); } catch {}
  }
}

main();
