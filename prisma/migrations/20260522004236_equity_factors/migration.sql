-- CreateTable
CREATE TABLE "equity_factors" (
    "id" TEXT NOT NULL,
    "factorType" TEXT NOT NULL,
    "shiftCode" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "equity_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equity_factors_factorType_shiftCode_key" ON "equity_factors"("factorType", "shiftCode");

-- Seed default equity factors
INSERT INTO "equity_factors" ("id", "factorType", "shiftCode", "weight", "enabled", "sortOrder") VALUES
    (gen_random_uuid()::text, 'desirability', NULL, 1.0, true, 0),
    (gen_random_uuid()::text, 'holiday', NULL, 1.0, true, 1),
    (gen_random_uuid()::text, 'shift', 'CALL', 1.0, true, 2),
    (gen_random_uuid()::text, 'shift', 'ORC', 1.0, true, 3),
    (gen_random_uuid()::text, 'shift', 'ORL', 1.0, true, 4);

-- Remove hardcoded weights from scheduling_preferences
ALTER TABLE "scheduling_preferences" DROP COLUMN IF EXISTS "fairnessDesirabilityWeight";
ALTER TABLE "scheduling_preferences" DROP COLUMN IF EXISTS "fairnessHolidayWeight";
