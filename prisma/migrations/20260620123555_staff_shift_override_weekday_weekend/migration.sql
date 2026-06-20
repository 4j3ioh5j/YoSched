-- Per-staff weekday/weekend shift-hour overrides. Additive and nullable: a NULL
-- day-type value falls back to the existing single `durationHrs` (legacy single
-- value is treated as both weekday and weekend until a split is set), so existing
-- override rows keep their current behavior with no backfill.
ALTER TABLE "staff_shift_overrides" ADD COLUMN "durationHrsWeekday" DOUBLE PRECISION;
ALTER TABLE "staff_shift_overrides" ADD COLUMN "durationHrsWeekend" DOUBLE PRECISION;
