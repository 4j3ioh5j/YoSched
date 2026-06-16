-- Slice 7 (final): drop the legacy recurrence columns. The unified WHEN model
-- (when* columns) has been the authoritative representation since slices 3-6;
-- every row was backfilled (whenKind set) and every write path now writes when*.
--
-- DEFENSIVE pre-drop backfill: re-derive when* from the legacy columns for any
-- row where whenKind is still NULL, mirroring the slice-3b / slice-6a backfills
-- EXACTLY. Prior migrations already set whenKind on all existing rows, so these
-- UPDATEs are expected to match zero rows — belt-and-suspenders so the drop can
-- never strip recurrence data that hadn't been migrated.
--
-- Bridge equivalence (legacyPatternToWhen / standingToWhen):
--   availability_rules / shift_eligibility_rules / employment_type_default_availability:
--     pattern 'pp_week_1' -> kind ppWeek, whenPpWeek 1
--     pattern 'pp_week_2' -> kind ppWeek, whenPpWeek 2
--     pattern 'every_n'   -> kind cycle (week, n=COALESCE(cycleLength,2), offset=COALESCE(cycleOffset,0))
--     pattern 'every'/else-> kind every
--     whenDays = ARRAY[dayOfWeek]
--   standing_commitments:
--     dayOfWeek NULL          -> kind every, no weekday filter
--     frequency 'biweekly'    -> kind cycle (week, n=2, offset=0)
--     frequency 'monthly'     -> kind ordinalMonth {1}
--     frequency 'weekly'/else -> kind every

-- availability_rules (has cycle)
UPDATE "availability_rules" SET
  "whenDays" = ARRAY["dayOfWeek"],
  "whenKind" = CASE
    WHEN "pattern" = 'pp_week_1' THEN 'ppWeek'
    WHEN "pattern" = 'pp_week_2' THEN 'ppWeek'
    WHEN "pattern" = 'every_n'   THEN 'cycle'
    ELSE 'every' END,
  "whenPpWeek" = CASE WHEN "pattern" = 'pp_week_1' THEN 1 WHEN "pattern" = 'pp_week_2' THEN 2 ELSE NULL END,
  "whenCycleUnit"   = CASE WHEN "pattern" = 'every_n' THEN 'week' ELSE NULL END,
  "whenCycleN"      = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleLength", 2) ELSE NULL END,
  "whenCycleOffset" = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleOffset", 0) ELSE NULL END
WHERE "whenKind" IS NULL;

-- shift_eligibility_rules (has cycle)
UPDATE "shift_eligibility_rules" SET
  "whenDays" = ARRAY["dayOfWeek"],
  "whenKind" = CASE
    WHEN "pattern" = 'pp_week_1' THEN 'ppWeek'
    WHEN "pattern" = 'pp_week_2' THEN 'ppWeek'
    WHEN "pattern" = 'every_n'   THEN 'cycle'
    ELSE 'every' END,
  "whenPpWeek" = CASE WHEN "pattern" = 'pp_week_1' THEN 1 WHEN "pattern" = 'pp_week_2' THEN 2 ELSE NULL END,
  "whenCycleUnit"   = CASE WHEN "pattern" = 'every_n' THEN 'week' ELSE NULL END,
  "whenCycleN"      = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleLength", 2) ELSE NULL END,
  "whenCycleOffset" = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleOffset", 0) ELSE NULL END
WHERE "whenKind" IS NULL;

-- employment_type_default_availability (no cycle; every / pp_week_1 / pp_week_2)
UPDATE "employment_type_default_availability" SET
  "whenDays" = ARRAY["dayOfWeek"],
  "whenKind" = CASE
    WHEN "pattern" = 'pp_week_1' THEN 'ppWeek'
    WHEN "pattern" = 'pp_week_2' THEN 'ppWeek'
    ELSE 'every' END,
  "whenPpWeek" = CASE WHEN "pattern" = 'pp_week_1' THEN 1 WHEN "pattern" = 'pp_week_2' THEN 2 ELSE NULL END
WHERE "whenKind" IS NULL;

-- standing_commitments (dayOfWeek + frequency)
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
  "whenOrds"        = CASE WHEN "dayOfWeek" IS NOT NULL AND "frequency" = 'monthly' THEN ARRAY[1] ELSE ARRAY[]::INTEGER[] END
WHERE "whenKind" IS NULL;

-- Drop the legacy columns now that when* is fully authoritative.
ALTER TABLE "availability_rules"
  DROP COLUMN "dayOfWeek",
  DROP COLUMN "pattern",
  DROP COLUMN "cycleLength",
  DROP COLUMN "cycleOffset";

ALTER TABLE "shift_eligibility_rules"
  DROP COLUMN "dayOfWeek",
  DROP COLUMN "pattern",
  DROP COLUMN "cycleLength",
  DROP COLUMN "cycleOffset";

ALTER TABLE "employment_type_default_availability"
  DROP COLUMN "dayOfWeek",
  DROP COLUMN "pattern";

ALTER TABLE "standing_commitments"
  DROP COLUMN "dayOfWeek",
  DROP COLUMN "frequency";
