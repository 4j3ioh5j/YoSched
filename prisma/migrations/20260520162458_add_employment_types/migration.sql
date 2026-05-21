-- Create employment_types table
CREATE TABLE "employment_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultIsAutoScheduled" BOOLEAN NOT NULL DEFAULT true,
    "defaultFtePercentage" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "defaultTakesCall" BOOLEAN NOT NULL DEFAULT true,
    "defaultTakesLate" BOOLEAN NOT NULL DEFAULT true,
    "defaultWorkingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_types_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on name
CREATE UNIQUE INDEX "employment_types_name_key" ON "employment_types"("name");

-- Seed the two default types
INSERT INTO "employment_types" ("id", "name", "defaultIsAutoScheduled", "defaultFtePercentage", "defaultTakesCall", "defaultTakesLate", "defaultWorkingDays", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('empl_fte', 'FTE', true, 1.0, true, true, ARRAY[1, 2, 3, 4, 5], 0, NOW(), NOW()),
  ('empl_fee_basis', 'Fee Basis', false, 0, false, false, ARRAY[]::integer[], 1, NOW(), NOW());

-- Add employmentTypeId column (nullable initially for migration)
ALTER TABLE "providers" ADD COLUMN "employmentTypeId" TEXT;

-- Map existing providers based on their freeform employmentType string
UPDATE "providers" SET "employmentTypeId" = 'empl_fte' WHERE "employmentType" = 'fte';
UPDATE "providers" SET "employmentTypeId" = 'empl_fee_basis' WHERE "employmentType" = 'fee_basis';
-- Catch any unexpected values
UPDATE "providers" SET "employmentTypeId" = 'empl_fte' WHERE "employmentTypeId" IS NULL;

-- Now make it non-nullable and add the FK
ALTER TABLE "providers" ALTER COLUMN "employmentTypeId" SET NOT NULL;
ALTER TABLE "providers" ADD CONSTRAINT "providers_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "employment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop the old freeform column
ALTER TABLE "providers" DROP COLUMN "employmentType";
