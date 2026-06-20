-- Split a shift type's single "hours per shift" into weekday / weekend / holiday.
-- `defaultHours` is kept as the WEEKDAY value (the base). Two columns are added
-- for the weekend and holiday values, and the old `countsOnWeekend` boolean is
-- dropped: "does this shift accrue hours on weekends/holidays?" is now expressed
-- directly as a 0 vs non-zero hour value.
--
-- Seeding (preserves current behavior exactly):
--   countsOnWeekend = true   -> weekend = holiday = defaultHours (it accrued full hours)
--   countsOnWeekend = false  -> weekend = holiday = 0            (it accrued none)
-- Note: a holiday that falls on a weekday previously counted full weekday hours;
-- after this change such a shift counts its (seeded) holiday value, so a
-- non-counting shift worked on a holiday now counts 0 — the intended fix.

-- 1) New columns. NOT NULL with a 0 default == "does not count" (matches the old
--    countsOnWeekend=false default for any row not touched below).
ALTER TABLE "shift_types" ADD COLUMN "defaultHoursWeekend" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "shift_types" ADD COLUMN "defaultHoursHoliday" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2) Shifts that counted on weekends accrue their full hours on weekends AND
--    holidays. Shifts that did not keep the 0 default from step 1.
UPDATE "shift_types"
   SET "defaultHoursWeekend" = "defaultHours",
       "defaultHoursHoliday" = "defaultHours"
 WHERE "countsOnWeekend" = true;

-- 3) Per-staff hour overrides: for shifts that did NOT count on weekends, the
--    old engine excluded weekend hours entirely regardless of the override row
--    (whose weekend value mirrored the weekday). Zero those weekend overrides so
--    removing the flag preserves "weekend hours = 0" for these shifts. (Holiday
--    overrides mirror the weekend resolution until item 2 adds them explicitly.)
UPDATE "staff_shift_overrides" o
   SET "durationHrsWeekend" = 0
  FROM "shift_types" s
 WHERE o."shiftTypeId" = s."id"
   AND s."countsOnWeekend" = false;

-- 4) Drop the now-redundant flag.
ALTER TABLE "shift_types" DROP COLUMN "countsOnWeekend";
