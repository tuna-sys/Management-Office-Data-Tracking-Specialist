import { splitImportReview } from "@/lib/import-review";
import { invalidateReadCache } from "@/lib/read-cache";
import {
  mkdir,
  writeFile,
  rename,
  readdir,
  readFile,
  unlink,
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const directory = path.resolve(
  process.env.LOCAL_IMPORT_SOURCE_DIR || ".local/source-imports",
);
const memoryCache = new Map<string, { mtimeMs: number; data: any }>();

export function buildImportSource(
  type: string,
  file: string,
  sheet: string,
  rows: any[],
  warnings: string[],
  errors: string[],
) {
  const id = randomUUID();

  const issuesByRow = new Map<number, string[]>();

  for (const message of [...warnings, ...errors]) {
    const match = /^Dòng (\d+):/.exec(message);
    if (!match) continue;
    const rowNumber = Number(match[1]);
    const issues = issuesByRow.get(rowNumber) || [];
    issues.push(message);
    issuesByRow.set(rowNumber, issues);
  }

  const payload = {
    id,
    type,
    file,
    sheet,
    createdAt: new Date().toISOString(),
    rows: rows.map((entry) => {
      const review = splitImportReview(issuesByRow.get(entry.row) || []);
      return {
        row: entry.row,
        values: entry.raw,
        warnings: review.warnings.map((issue) => issue.message),
        duplicates: review.duplicates.map((issue) => issue.message),
      };
    }),
  };

  return payload;
}

export async function importSourcePublished(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Mã nguồn không hợp lệ");
  try {
    const data = JSON.parse(await readFile(path.join(directory, id + ".json"), "utf8"));
    if (data.id !== id) throw new Error("Snapshot nguồn không khớp mã phiên");
    return true;
  } catch (error: any) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function publishImportSource(payload: ReturnType<typeof buildImportSource>) {
  // Existing snapshots may already have authorized review corrections: never overwrite them on retry.
  if (await importSourcePublished(payload.id)) return payload.id;
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, payload.id + ".json");
  await writeFile(target + ".tmp", JSON.stringify(payload), "utf8");
  await rename(target + ".tmp", target);
  memoryCache.clear();
  invalidateReadCache();
  return payload.id;
}

export async function saveImportSource(...args: Parameters<typeof buildImportSource>) {
  return publishImportSource(buildImportSource(...args));
}

export async function readImportSources() {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const jsonFiles = files.filter((file) => /^[a-f0-9-]+\.json$/.test(file));
  const results = await Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = path.join(directory, file);
      try {
        const fileStat = await stat(filePath);
        const cached = memoryCache.get(file);
        if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.data;
        const data = JSON.parse(await readFile(filePath, "utf8"));
        memoryCache.set(file, { mtimeMs: fileStat.mtimeMs, data });
        return data;
      } catch {
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}

export async function deleteImportSource(id?: string) {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error: any) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const file of files.filter((name) => /^[a-f0-9-]+\.json$/.test(name))) {
    if (!id || file === `${id}.json`) {
      memoryCache.delete(file);
      await unlink(path.join(directory, file)).catch(() => {});
      invalidateReadCache();
    }
  }
}

export async function resolveImportSourceRow(
  sourceId: string,
  rowNumber: number,
  mode: "APPROVE" | "DELETE",
) {
  const fileName = `${sourceId}.json`;
  const filePath = path.join(directory, fileName);
  const data = JSON.parse(await readFile(filePath, "utf8"));
  const targetRow = (data.rows || []).find(
    (row: any) => Number(row.row) === Number(rowNumber),
  );
  if (!targetRow) return null;

  if (mode === "DELETE") {
    data.rows = (data.rows || []).filter(
      (row: any) => Number(row.row) !== Number(rowNumber),
    );
  } else {
    targetRow.warnings = [];
    targetRow.duplicates = [];
    targetRow.isApproved = true;
  }

  await writeFile(`${filePath}.tmp`, JSON.stringify(data), "utf8");
  await rename(`${filePath}.tmp`, filePath);
  memoryCache.delete(fileName);
  invalidateReadCache();
  return { source: data, row: targetRow };
}

export async function correctImportSourceDate(
  sourceId: string,
  rowNumber: number,
  interviewDate: string,
) {
  if (!/^[a-f0-9-]+$/.test(sourceId))
    throw new Error("Mã nguồn không hợp lệ");
  const filePath = path.join(directory, `${sourceId}.json`);
  const data = JSON.parse(await readFile(filePath, "utf8"));
  const row = (data.rows || []).find(
    (entry: any) => Number(entry.row) === rowNumber,
  );
  if (!row) throw new Error("Không tìm thấy dòng nguồn");

  row.values = { ...row.values, "Ngày PV": interviewDate };
  await writeFile(`${filePath}.tmp`, JSON.stringify(data), "utf8");
  await rename(`${filePath}.tmp`, filePath);
  memoryCache.delete(`${sourceId}.json`);
  invalidateReadCache();
}