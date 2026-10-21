-- Normalize factory and labor-status catalogs for assignments and bonus policies.
-- Keep legacy text columns as display/history snapshots. New IDs stay nullable until
-- all legacy values have been reviewed and the application has fully backfilled them.

ALTER TABLE "WorkAssignment" ADD COLUMN "interviewFactoryId" TEXT
  REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkAssignment" ADD COLUMN "workingFactoryId" TEXT
  REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkAssignment" ADD COLUMN "statusId" TEXT
  REFERENCES "LaborStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusPolicy" ADD COLUMN "factoryId" TEXT
  REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "WorkAssignment"
SET "interviewFactoryId" = (
  SELECT f."id" FROM "Factory" f
  WHERE lower(trim(f."name")) = lower(trim("WorkAssignment"."interviewFactory"))
  ORDER BY f."id" LIMIT 1
)
WHERE "interviewFactoryId" IS NULL;

UPDATE "WorkAssignment"
SET "workingFactoryId" = (
  SELECT f."id" FROM "Factory" f
  WHERE lower(trim(f."name")) = lower(trim("WorkAssignment"."workingFactory"))
  ORDER BY f."id" LIMIT 1
)
WHERE "workingFactoryId" IS NULL
  AND NULLIF(trim("workingFactory"), '') IS NOT NULL;

UPDATE "WorkAssignment"
SET "statusId" = (
  SELECT s."id" FROM "LaborStatus" s
  WHERE lower(trim(s."name")) = lower(trim("WorkAssignment"."status"))
  ORDER BY s."id" LIMIT 1
)
WHERE "statusId" IS NULL;

UPDATE "RecruitmentOrder"
SET "factoryId" = (
  SELECT f."id" FROM "Factory" f
  WHERE lower(trim(f."name")) = lower(trim("RecruitmentOrder"."factory"))
  ORDER BY f."id" LIMIT 1
)
WHERE "factoryId" IS NULL;

UPDATE "BonusPolicy"
SET "factoryId" = (
  SELECT f."id" FROM "Factory" f
  WHERE lower(trim(f."name")) = lower(trim("BonusPolicy"."factory"))
  ORDER BY f."id" LIMIT 1
)
WHERE "factoryId" IS NULL;

CREATE INDEX "WorkAssignment_interviewFactoryId_idx" ON "WorkAssignment"("interviewFactoryId");
CREATE INDEX "WorkAssignment_workingFactoryId_idx" ON "WorkAssignment"("workingFactoryId");
CREATE INDEX "WorkAssignment_statusId_idx" ON "WorkAssignment"("statusId");
CREATE INDEX "WorkAssignment_orderId_batchId_idx" ON "WorkAssignment"("orderId", "batchId");
CREATE INDEX "BonusPolicy_factoryId_idx" ON "BonusPolicy"("factoryId");

-- Enforce that a selected recruitment batch belongs to the selected order.
CREATE TRIGGER "WorkAssignment_batch_order_insert_check"
BEFORE INSERT ON "WorkAssignment"
WHEN NEW."batchId" IS NOT NULL
 AND (NEW."orderId" IS NULL OR NOT EXISTS (
   SELECT 1 FROM "RecruitmentBatch" b
   WHERE b."id" = NEW."batchId" AND b."orderId" = NEW."orderId"
 ))
BEGIN
  SELECT RAISE(ABORT, 'batchId must belong to the selected orderId');
END;

CREATE TRIGGER "WorkAssignment_batch_order_update_check"
BEFORE UPDATE OF "batchId", "orderId" ON "WorkAssignment"
WHEN NEW."batchId" IS NOT NULL
 AND (NEW."orderId" IS NULL OR NOT EXISTS (
   SELECT 1 FROM "RecruitmentBatch" b
   WHERE b."id" = NEW."batchId" AND b."orderId" = NEW."orderId"
 ))
BEGIN
  SELECT RAISE(ABORT, 'batchId must belong to the selected orderId');
END;

-- Enforce order/factory agreement only when the order itself has a normalized factory ID.
CREATE TRIGGER "WorkAssignment_order_factory_insert_check"
BEFORE INSERT ON "WorkAssignment"
WHEN NEW."orderId" IS NOT NULL
 AND NEW."interviewFactoryId" IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM "RecruitmentOrder" o
   WHERE o."id" = NEW."orderId" AND o."factoryId" IS NOT NULL
 )
 AND NOT EXISTS (
   SELECT 1 FROM "RecruitmentOrder" o
   WHERE o."id" = NEW."orderId" AND o."factoryId" = NEW."interviewFactoryId"
 )
BEGIN
  SELECT RAISE(ABORT, 'interview factory must match the recruitment order factory');
END;

CREATE TRIGGER "WorkAssignment_order_factory_update_check"
BEFORE UPDATE OF "orderId", "interviewFactoryId" ON "WorkAssignment"
WHEN NEW."orderId" IS NOT NULL
 AND NEW."interviewFactoryId" IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM "RecruitmentOrder" o
   WHERE o."id" = NEW."orderId" AND o."factoryId" IS NOT NULL
 )
 AND NOT EXISTS (
   SELECT 1 FROM "RecruitmentOrder" o
   WHERE o."id" = NEW."orderId" AND o."factoryId" = NEW."interviewFactoryId"
 )
BEGIN
  SELECT RAISE(ABORT, 'interview factory must match the recruitment order factory');
END;
