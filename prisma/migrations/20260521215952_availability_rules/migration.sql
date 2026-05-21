-- CreateTable
CREATE TABLE "availability_rules" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'available',
    "strength" TEXT NOT NULL DEFAULT 'rule',
    "pattern" TEXT NOT NULL DEFAULT 'every',
    "cycleLength" INTEGER,
    "cycleOffset" INTEGER,
    "conditionProviderId" TEXT,
    "conditionType" TEXT,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_type_default_availability" (
    "id" TEXT NOT NULL,
    "employmentTypeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'available',
    "strength" TEXT NOT NULL DEFAULT 'rule',
    "pattern" TEXT NOT NULL DEFAULT 'every',

    CONSTRAINT "employment_type_default_availability_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_conditionProviderId_fkey" FOREIGN KEY ("conditionProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_type_default_availability" ADD CONSTRAINT "employment_type_default_availability_employmentTypeId_fkey" FOREIGN KEY ("employmentTypeId") REFERENCES "employment_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate provider workingDays to availability_rules
INSERT INTO "availability_rules" ("id", "providerId", "dayOfWeek", "type", "strength", "pattern")
SELECT
    gen_random_uuid()::text,
    p."id",
    d.day,
    'available',
    'rule',
    'every'
FROM "providers" p
CROSS JOIN LATERAL unnest(p."workingDays") AS d(day);

-- Migrate employment type defaultWorkingDays to employment_type_default_availability
INSERT INTO "employment_type_default_availability" ("id", "employmentTypeId", "dayOfWeek", "type", "strength", "pattern")
SELECT
    gen_random_uuid()::text,
    et."id",
    d.day,
    'available',
    'rule',
    'every'
FROM "employment_types" et
CROSS JOIN LATERAL unnest(et."defaultWorkingDays") AS d(day);

-- Drop old columns
ALTER TABLE "providers" DROP COLUMN "workingDays";
ALTER TABLE "employment_types" DROP COLUMN "defaultWorkingDays";
