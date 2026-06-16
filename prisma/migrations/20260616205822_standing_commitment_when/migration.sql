-- Unified WHEN recurrence model (recurrence.ts) for StandingCommitment. Adds the
-- normalized when* columns alongside the legacy dayOfWeek + frequency columns and
-- backfills from them. whenKind is the discriminator — non-null means readers
-- (standingToWhen) use the when* columns; null falls back to the legacy columns.
-- Legacy columns are kept for reversibility.
--
-- The backfill mirrors standingToWhen() EXACTLY:
--   dayOfWeek NULL            → kind "every", no weekday filter (preserves the
--                               legacy "fires on every applicable day" behavior,
--                               which the old scheduler did for any day-null row
--                               regardless of frequency).
--   dayOfWeek set, weekly     → kind "every" on that weekday.
--   dayOfWeek set, biweekly   → kind "cycle" (week, n=2, offset=0) = every other week.
--   dayOfWeek set, monthly    → kind "ordinalMonth" {1} = 1st occurrence of that
--                               weekday in the calendar month.
-- Audit: production/seed data contains only weekly (day-null) rows; biweekly/
-- monthly backfill paths are defined for completeness but match zero existing rows.

ALTER TABLE "standing_commitments"
  ADD COLUMN "whenKind" TEXT,
  ADD COLUMN "whenDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenPpWeek" INTEGER,
  ADD COLUMN "whenOrds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenCycleUnit" TEXT,
  ADD COLUMN "whenCycleN" INTEGER,
  ADD COLUMN "whenCycleOffset" INTEGER;

UPDATE "standing_commitments" SET
  "whenDays" = CASE WHEN "dayOfWeek" IS NOT NULL THEN ARRAY["dayOfWeek"] ELSE ARRAY[]::INTEGER[] END,
  "whenKind" = CASE
    WHEN "dayOfWeek" IS NULL THEN 'every'
    WHEN "frequency" = 'biweekly' THEN 'cycle'
    WHEN "frequency" = 'monthly' THEN 'ordinalMonth'
    ELSE 'every' END,
  "whenCycleUnit"   = CASE WHEN "dayOfWeek" IS NOT NULL AND "frequency" = 'biweekly' THEN 'week' ELSE NULL END,
  "whenCycleN"      = CASE WHEN "dayOfWeek" IS NOT NULL AND "frequency" = 'biweekly' THEN 2 ELSE NULL END,
  "whenCycleOffset" = CASE WHEN "dayOfWeek" IS NOT NULL AND "frequency" = 'biweekly' THEN 0 ELSE NULL END,
  "whenOrds"        = CASE WHEN "dayOfWeek" IS NOT NULL AND "frequency" = 'monthly' THEN ARRAY[1] ELSE ARRAY[]::INTEGER[] END;
