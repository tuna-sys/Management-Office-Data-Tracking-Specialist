CREATE TABLE "DuplicateResolution" (
  "alertId" TEXT NOT NULL PRIMARY KEY,
  "resolvedBy" TEXT NOT NULL,
  "resolvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT
);
CREATE INDEX "DuplicateResolution_resolvedAt_idx" ON "DuplicateResolution"("resolvedAt");
