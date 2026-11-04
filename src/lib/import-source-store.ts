import { splitImportReview } from "@/lib/import-review";
import { invalidateReadCache } from "@/lib/read-cache";
import { prisma } from "@/lib/prisma";
import { createHash, randomUUID } from "node:crypto";

const memoryCache = new Map<string, { data: any[] }>();
const json = (value: unknown) => JSON.stringify(value ?? {});
const parseJson = (value: unknown, fallback: any) => {
  try { return JSON.parse(String(value ?? "")); } catch { return fallback; }
};
const sourceRowId = (sourceId: string, rowNumber: number) => `${sourceId}:${Number(rowNumber)}`;
const issueId = (rowId: string, kind: string, message: string, index: number) =>
  createHash("sha256").update(`${rowId}\0${kind}\0${index}\0${message}`).digest("hex");

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
  return {
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
}

async function findBatch(id: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    'SELECT "id", "type", "file", "sheet", "createdAt" FROM "ImportBatch" WHERE "id" = ?',
    id,
  );
  return rows[0] || null;
}

export async function importSourcePublished(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Mã nguồn không hợp lệ");
  return Boolean(await findBatch(id));
}

export async function publishImportSource(payload: any) {
  if (await importSourcePublished(payload.id)) return payload.id;
  const createdAt = payload.createdAt || new Date().toISOString();
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'INSERT OR IGNORE INTO "ImportBatch" ("id","type","file","sheet","createdAt") VALUES (?,?,?,?,?)',
      payload.id, payload.type, payload.file, payload.sheet, createdAt,
    );
    for (const row of payload.rows || []) {
      const id = sourceRowId(payload.id, row.row);
      const warnings = Array.isArray(row.warnings) ? row.warnings : [];
      const duplicates = Array.isArray(row.duplicates) ? row.duplicates : [];
      await tx.$executeRawUnsafe(
        'INSERT OR IGNORE INTO "ImportSourceRow" ("id","sourceId","rowNumber","valuesJson","warningsJson","duplicatesJson","isApproved","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)',
        id, payload.id, Number(row.row), json(row.values), json(warnings), json(duplicates), row.isApproved ? 1 : 0, createdAt, row.updatedAt || createdAt,
      );
      const classified = splitImportReview([...warnings, ...duplicates]);
      const kinds = new Map(classified.warnings.concat(classified.duplicates).map((item) => [item.message, item.kind]));
      for (const [kind, messages] of [["WARNING", warnings], ["DUPLICATE", duplicates]] as const) {
        for (let i = 0; i < messages.length; i++) {
          const message = String(messages[i] ?? "");
          await tx.$executeRawUnsafe(
            'INSERT OR IGNORE INTO "DataIssue" ("id","sourceRowId","kind","message","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)',
            issueId(id, kind, message, i), id, kinds.get(message) || kind, message, row.isApproved ? "RESOLVED" : "OPEN", createdAt, row.updatedAt || createdAt,
          );
        }
      }
    }
  }, { timeout: 120000 });
  memoryCache.clear();
  invalidateReadCache();
  return payload.id;
}

export async function saveImportSource(...args: Parameters<typeof buildImportSource>) {
  return publishImportSource(buildImportSource(...args));
}

export async function readImportSources() {
  const cached = memoryCache.get("all");
  if (cached) return cached.data;
  const [batches, rows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      'SELECT "id", "type", "file", "sheet", "createdAt" FROM "ImportBatch" ORDER BY "createdAt", "id"',
    ),
    prisma.$queryRawUnsafe<any[]>(
      'SELECT "id", "sourceId", "rowNumber", "valuesJson", "warningsJson", "duplicatesJson", "isApproved" FROM "ImportSourceRow" ORDER BY "sourceId", "rowNumber"',
    ),
  ]);
  const byId = new Map<string, any>();
  for (const batch of batches) byId.set(batch.id, { id: batch.id, type: batch.type, file: batch.file, sheet: batch.sheet, createdAt: batch.createdAt, rows: [] });
  for (const row of rows) {
    const source = byId.get(row.sourceId);
    if (!source) continue;
    source.rows.push({
      row: Number(row.rowNumber),
      values: parseJson(row.valuesJson, {}),
      warnings: parseJson(row.warningsJson, []),
      duplicates: parseJson(row.duplicatesJson, []),
      ...(row.isApproved ? { isApproved: true } : {}),
    });
  }
  const data = [...byId.values()];
  memoryCache.set("all", { data });
  return data;
}

export async function readOpenImportIssues() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT b."id" AS "sourceId", b."type", b."file", b."sheet", b."createdAt" AS "sourceCreatedAt",
      r."id" AS "rowId", r."rowNumber", r."valuesJson", r."warningsJson", r."duplicatesJson",
      i."kind", i."message", i."status", i."createdAt" AS "issueCreatedAt"
     FROM "DataIssue" i
     JOIN "ImportSourceRow" r ON r."id" = i."sourceRowId"
     JOIN "ImportBatch" b ON b."id" = r."sourceId"
     WHERE i."status" = 'OPEN'
     ORDER BY b."createdAt", b."id", r."rowNumber", i."kind", i."id"`,
  );
  const batches = new Map<string, any>();
  for (const item of rows) {
    let source = batches.get(item.sourceId);
    if (!source) {
      source = { id: item.sourceId, type: item.type, file: item.file, sheet: item.sheet, createdAt: item.sourceCreatedAt, rows: [] };
      batches.set(item.sourceId, source);
    }
    let row = source.rows[source.rows.length - 1];
    if (!row || row.row !== Number(item.rowNumber)) {
      row = { row: Number(item.rowNumber), values: parseJson(item.valuesJson, {}), warnings: [], duplicates: [] };
      source.rows.push(row);
    }
    const review = splitImportReview([item.message]);
    const target = review.duplicates.length ? row.duplicates : row.warnings;
    if (!target.includes(item.message)) target.push(item.message);
  }
  return [...batches.values()];
}

export async function readImportSourceRow(sourceId: string, rowNumber: number) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT b."id", b."type", b."file", b."sheet", b."createdAt",
      r."rowNumber", r."valuesJson", r."warningsJson", r."duplicatesJson", r."isApproved"
     FROM "ImportBatch" b JOIN "ImportSourceRow" r ON r."sourceId" = b."id"
     WHERE b."id" = ? AND r."rowNumber" = ? LIMIT 1`,
    sourceId, rowNumber,
  );
  const item = rows[0];
  if (!item) return null;
  return {
    source: { id: item.id, type: item.type, file: item.file, sheet: item.sheet, createdAt: item.createdAt },
    row: {
      row: Number(item.rowNumber),
      values: parseJson(item.valuesJson, {}),
      warnings: parseJson(item.warningsJson, []),
      duplicates: parseJson(item.duplicatesJson, []),
      ...(item.isApproved ? { isApproved: true } : {}),
    },
  };
}

export async function deleteImportSource(id?: string) {
  if (id) await prisma.$executeRawUnsafe('DELETE FROM "ImportBatch" WHERE "id" = ?', id);
  else await prisma.$executeRawUnsafe('DELETE FROM "ImportBatch"');
  memoryCache.clear();
  invalidateReadCache();
}

export async function resolveImportSourceRow(
  sourceId: string,
  rowNumber: number,
  mode: "APPROVE" | "DELETE",
  resolvedBy = "Hệ thống",
) {
  const batch = await findBatch(sourceId);
  if (!batch) return null;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    'SELECT "id", "rowNumber", "valuesJson", "warningsJson", "duplicatesJson", "isApproved" FROM "ImportSourceRow" WHERE "sourceId" = ? AND "rowNumber" = ?',
    sourceId, rowNumber,
  );
  const stored = rows[0];
  if (!stored) return null;
  const row = {
    row: Number(stored.rowNumber),
    values: parseJson(stored.valuesJson, {}),
    warnings: parseJson(stored.warningsJson, []),
    duplicates: parseJson(stored.duplicatesJson, []),
    ...(stored.isApproved ? { isApproved: true } : {}),
  };
  const resolvedAt = new Date().toISOString();
  await prisma.$transaction(async (tx: any) => {
    if (mode === "DELETE") {
      await tx.$executeRawUnsafe('DELETE FROM "ImportSourceRow" WHERE "id" = ?', stored.id);
    } else {
      await tx.$executeRawUnsafe(
        'UPDATE "ImportSourceRow" SET "warningsJson" = ?, "duplicatesJson" = ?, "isApproved" = 1, "updatedAt" = ? WHERE "id" = ?',
        "[]", "[]", resolvedAt, stored.id,
      );
      await tx.$executeRawUnsafe(
        'UPDATE "DataIssue" SET "status" = ?, "resolvedBy" = ?, "resolvedAt" = ?, "updatedAt" = ? WHERE "sourceRowId" = ? AND "status" = ?',
        "RESOLVED", resolvedBy, resolvedAt, resolvedAt, stored.id, "OPEN",
      );
    }
  });
  memoryCache.clear();
  invalidateReadCache();
  return { source: { ...batch, rows: mode === "DELETE" ? [] : [row] }, row };
}

export async function correctImportSourceDate(
  sourceId: string,
  rowNumber: number,
  interviewDate: string,
) {
  if (!/^[a-f0-9-]+$/i.test(sourceId)) throw new Error("Mã nguồn không hợp lệ");
  const rows = await prisma.$queryRawUnsafe<any[]>(
    'SELECT "id", "valuesJson" FROM "ImportSourceRow" WHERE "sourceId" = ? AND "rowNumber" = ?',
    sourceId, rowNumber,
  );
  if (!rows[0]) throw new Error("Không tìm thấy dòng nguồn");
  const values = parseJson(rows[0].valuesJson, {});
  values["Ngày PV"] = interviewDate;
  await prisma.$executeRawUnsafe(
    'UPDATE "ImportSourceRow" SET "valuesJson" = ?, "updatedAt" = ? WHERE "id" = ?',
    json(values), new Date().toISOString(), rows[0].id,
  );
  memoryCache.clear();
  invalidateReadCache();
}
