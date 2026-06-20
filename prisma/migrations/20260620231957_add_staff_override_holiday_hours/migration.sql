-- Per-staff shift-hour override gains an explicit HOLIDAY value, matching the
-- weekday/weekend split added in 20260620123555 and the shift-type-level
-- weekday/weekend/holiday split in 20260620153350.
--
-- Nullable on purpose: a NULL holiday value falls back to the override's weekend
-- resolution, which is exactly how holidays were valued before this column
-- existed. No backfill is needed — every existing row keeps its current behavior.
ALTER TABLE "staff_shift_overrides" ADD COLUMN "durationHrsHoliday" DOUBLE PRECISION;
