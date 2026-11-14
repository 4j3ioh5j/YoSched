-- Card #210: holiday types and holiday rules. Additive; rollback is code-only
-- (old code ignores the new tables and column).
CREATE TABLE "holiday_types" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "holiday_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holiday_types_name_key" ON "holiday_types"("name");

ALTER TABLE "holidays" ADD COLUMN "holidayTypeId" TEXT;
CREATE INDEX "holidays_holidayTypeId_idx" ON "holidays"("holidayTypeId");
ALTER TABLE "holidays"
  ADD CONSTRAINT "holidays_holidayTypeId_fkey"
  FOREIGN KEY ("holidayTypeId") REFERENCES "holiday_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "holiday_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "holidayTypeId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "holiday_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holiday_rules_holidayTypeId_name_key" ON "holiday_rules"("holidayTypeId", "name");
ALTER TABLE "holiday_rules"
  ADD CONSTRAINT "holiday_rules_holidayTypeId_fkey"
  FOREIGN KEY ("holidayTypeId") REFERENCES "holiday_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "holiday_rule_days" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "offset" INTEGER NOT NULL,
  "shiftTypeId" TEXT NOT NULL,
  CONSTRAINT "holiday_rule_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holiday_rule_days_ruleId_offset_key" ON "holiday_rule_days"("ruleId", "offset");
ALTER TABLE "holiday_rule_days"
  ADD CONSTRAINT "holiday_rule_days_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "holiday_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "holiday_rule_days"
  ADD CONSTRAINT "holiday_rule_days_shiftTypeId_fkey"
  FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one type per distinct holiday name with a trailing " (observed)" removed,
-- and every dated holiday linked to its type. Ids are generated here (no extension needed).
INSERT INTO "holiday_types" ("id", "name", "updatedAt")
SELECT 'ht_' || md5(n.base), n.base, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT btrim(regexp_replace("name", '\s*\(observed\)\s*$', '', 'i')) AS base
  FROM "holidays"
) n
WHERE n.base <> ''
ON CONFLICT ("name") DO NOTHING;

UPDATE "holidays" h
SET "holidayTypeId" = t."id"
FROM "holiday_types" t
WHERE h."holidayTypeId" IS NULL
  AND t."name" = btrim(regexp_replace(h."name", '\s*\(observed\)\s*$', '', 'i'));
