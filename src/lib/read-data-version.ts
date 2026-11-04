import { createHash } from "node:crypto";
import { stat, open, readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { readCacheEpoch } from "@/lib/read-cache";

let databasePath: Promise<string | null> | undefined;
async function fileVersion(file: string) {
  try { const s = await stat(file); return [file, s.size, s.mtimeMs, s.ctimeMs]; }
  catch (error: any) { if (error.code === "ENOENT") return [file, "missing"]; throw error; }
}
async function sqliteVersion(db: string | null) {
  if (!db) return "memory";
  const file = await open(db, "r");
  const header = Buffer.alloc(100);
  try { await file.read(header, 0, 100, 0); } finally { await file.close(); }
  let wal = "";
  try {
    const walPath = db + "-wal";
    const walFile = await open(walPath, "r");
    try {
      const meta = await walFile.stat();
      if (meta.size <= 2 * 1024 * 1024) {
        wal = createHash("sha256")
          .update(await readFile(walPath))
          .digest("hex");
      } else {
        // Large WALs used to get a unique cache key for every request. Hash only
        // the WAL header and final frame header (includes SQLite rolling checksums)
        // to retain stable reuse while detecting same-size commits.
        const walHeader = Buffer.alloc(32);
        await walFile.read(walHeader, 0, walHeader.length, 0);
        const encodedPageSize = walHeader.readUInt32BE(8);
        const pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
        const frameSize = pageSize + 24;
        const frameOffset = pageSize >= 512 && meta.size >= frameSize
          ? meta.size - frameSize
          : Math.max(0, meta.size - 24);
        const frameHeader = Buffer.alloc(24);
        const frame = await walFile.read(
          frameHeader,
          0,
          frameHeader.length,
          frameOffset,
        );
        wal = createHash("sha256")
          .update(walHeader)
          .update(frameHeader.subarray(0, frame.bytesRead))
          .update(String(meta.size))
          .digest("hex");
      }
    } finally {
      await walFile.close();
    }
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  return [header.toString("hex"), wal];
}
export async function readDataVersion() {
  if (!databasePath) {
    databasePath = prisma.$queryRawUnsafe<Array<{name: string; file: string}>>("PRAGMA database_list")
      .then(rows => rows.find(row => row.name === "main")?.file || null)
      .catch(error => { databasePath = undefined; throw error; });
  }
  const db = await databasePath;
  const files = db ? [db, db + "-wal", db + "-journal"] : [];
  return JSON.stringify([process.env.DATABASE_URL, readCacheEpoch(), await sqliteVersion(db), await Promise.all(files.map(fileVersion))]);
}
