import { createHash } from "node:crypto";
import { readdir, stat, open, readFile } from "node:fs/promises";
import path from "node:path";
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
    const meta = await stat(db + "-wal");
    // Coarse filesystem timestamps cannot detect same-size SQLite commits.
    // Hash small WALs; bypass reuse for large active WALs rather than return stale results.
    wal = meta.size > 2 * 1024 * 1024 ? "active-wal:" + process.hrtime.bigint()
      : createHash("sha256").update(await readFile(db + "-wal")).digest("hex");
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
  const directory = path.resolve(".local/source-imports");
  let names: string[];
  try { names = (await readdir(directory)).filter(n => /^[a-f0-9-]+\.json$/.test(n)).sort(); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; names = []; }
  const files = [path.resolve(".local/resolved-duplicates.json"), ...names.map(n => path.join(directory, n)), ...(db ? [db, db + "-wal", db + "-journal"] : [])];
  return JSON.stringify([process.env.DATABASE_URL, readCacheEpoch(), await sqliteVersion(db), await Promise.all(files.map(fileVersion))]);
}
