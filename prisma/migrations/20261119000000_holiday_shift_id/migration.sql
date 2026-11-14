-- Card #207: the holiday shift is chosen in Settings and linked by id instead of being
-- found by the code 'HOL'. Additive; rollback is code-only (old code ignores the column).
ALTER TABLE "scheduling_preferences" ADD COLUMN "holidayShiftId" TEXT;

ALTER TABLE "scheduling_preferences"
  ADD CONSTRAINT "scheduling_preferences_holidayShiftId_fkey"
  FOREIGN KEY ("holidayShiftId") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the one shift coded 'HOL', only if it is a valid holiday-credit shift
-- (leave, counts toward FTE, not an off shift) — the same rule as isHolidayCreditShift.
UPDATE "scheduling_preferences" sp
SET "holidayShiftId" = h."id"
FROM (
  SELECT MIN(st."id") AS "id"
  FROM "shift_types" st
  WHERE st."code" = 'HOL'
  HAVING COUNT(*) = 1
) h
JOIN "shift_types" v ON v."id" = h."id"
WHERE sp."holidayShiftId" IS NULL
  AND v."isLeave" AND v."countsTowardFte" AND NOT v."isOffShift";
