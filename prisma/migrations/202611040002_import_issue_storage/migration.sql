CREATE TABLE "ImportBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "file" TEXT NOT NULL,
  "sheet" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL
);
CREATE INDEX "ImportBatch_type_createdAt_idx" ON "ImportBatch"("type", "createdAt");
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

CREATE TABLE "ImportSourceRow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "valuesJson" TEXT NOT NULL,
  "warningsJson" TEXT NOT NULL DEFAULT '[]',
  "duplicatesJson" TEXT NOT NULL DEFAULT '[]',
  "isApproved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ImportSourceRow_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportSourceRow_sourceId_rowNumber_key" ON "ImportSourceRow"("sourceId", "rowNumber");
CREATE INDEX "ImportSourceRow_sourceId_rowNumber_idx" ON "ImportSourceRow"("sourceId", "rowNumber");
CREATE INDEX "ImportSourceRow_isApproved_rowNumber_idx" ON "ImportSourceRow"("isApproved", "rowNumber");

CREATE TABLE "DataIssue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceRowId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedBy" TEXT,
  "resolvedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DataIssue_sourceRowId_fkey" FOREIGN KEY ("sourceRowId") REFERENCES "ImportSourceRow"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DataIssue_status_kind_createdAt_idx" ON "DataIssue"("status", "kind", "createdAt");
CREATE INDEX "DataIssue_sourceRowId_kind_idx" ON "DataIssue"("sourceRowId", "kind");
