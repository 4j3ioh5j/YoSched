-- 1. Create join tables

CREATE TABLE "provider_eligible_shifts" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    CONSTRAINT "provider_eligible_shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_eligible_shifts_providerId_shiftTypeId_key"
    ON "provider_eligible_shifts"("providerId", "shiftTypeId");

ALTER TABLE "provider_eligible_shifts"
    ADD CONSTRAINT "provider_eligible_shifts_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_eligible_shifts"
    ADD CONSTRAINT "provider_eligible_shifts_shiftTypeId_fkey"
    FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "employment_type_default_shifts" (
    "id" TEXT NOT NULL,
    "employmentTypeId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    CONSTRAINT "employment_type_default_shifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employment_type_default_shifts_employmentTypeId_shiftTypeId_key"
    ON "employment_type_default_shifts"("employmentTypeId", "shiftTypeId");

ALTER TABLE "employment_type_default_shifts"
    ADD CONSTRAINT "employment_type_default_shifts_employmentTypeId_fkey"
    FOREIGN KEY ("employmentTypeId") REFERENCES "employment_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employment_type_default_shifts"
    ADD CONSTRAINT "employment_type_default_shifts_shiftTypeId_fkey"
    FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Populate provider_eligible_shifts: every provider gets every shift type,
--    EXCEPT where the old booleans say they're ineligible for ORC/CALL/ORL.

-- First: insert ALL provider×shiftType combinations
INSERT INTO "provider_eligible_shifts" ("id", "providerId", "shiftTypeId")
SELECT gen_random_uuid()::text, p.id, st.id
FROM "providers" p
CROSS JOIN "shift_types" st;

-- Then: remove rows where old booleans say ineligible
DELETE FROM "provider_eligible_shifts"
WHERE id IN (
    SELECT pes.id
    FROM "provider_eligible_shifts" pes
    JOIN "providers" p ON pes."providerId" = p.id
    JOIN "shift_types" st ON pes."shiftTypeId" = st.id
    WHERE (st.code = 'ORC' AND p."takesCall" = false)
       OR (st.code = 'CALL' AND p."takesWeekendCall" = false)
       OR (st.code = 'ORL' AND p."takesLate" = false)
);

-- 3. Populate employment_type_default_shifts: every employment type gets every shift type,
--    EXCEPT where the old defaults say ineligible for ORC/CALL/ORL.

INSERT INTO "employment_type_default_shifts" ("id", "employmentTypeId", "shiftTypeId")
SELECT gen_random_uuid()::text, et.id, st.id
FROM "employment_types" et
CROSS JOIN "shift_types" st;

DELETE FROM "employment_type_default_shifts"
WHERE id IN (
    SELECT etds.id
    FROM "employment_type_default_shifts" etds
    JOIN "employment_types" et ON etds."employmentTypeId" = et.id
    JOIN "shift_types" st ON etds."shiftTypeId" = st.id
    WHERE (st.code = 'ORC' AND et."defaultTakesCall" = false)
       OR (st.code = 'CALL' AND et."defaultTakesWeekendCall" = false)
       OR (st.code = 'ORL' AND et."defaultTakesLate" = false)
);

-- 4. Drop old columns

ALTER TABLE "providers" DROP COLUMN "takesCall";
ALTER TABLE "providers" DROP COLUMN "takesWeekendCall";
ALTER TABLE "providers" DROP COLUMN "takesLate";

ALTER TABLE "employment_types" DROP COLUMN "defaultTakesCall";
ALTER TABLE "employment_types" DROP COLUMN "defaultTakesWeekendCall";
ALTER TABLE "employment_types" DROP COLUMN "defaultTakesLate";

ALTER TABLE "shift_types" DROP COLUMN "eligibilityRule";
