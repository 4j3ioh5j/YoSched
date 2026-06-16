-- Unified WHEN recurrence model (recurrence.ts). Dual-column transition: add the
-- normalized when* columns alongside the legacy dayOfWeek/pattern/cycleLength/
-- cycleOffset columns and backfill from them. whenKind is the discriminator —
-- a non-null value means readers (ruleToWhen) use the when* columns; null means
-- fall back to the legacy columns. Legacy columns are kept for reversibility.

-- ── availability_rules ──
ALTER TABLE "availability_rules"
  ADD COLUMN "whenKind" TEXT,
  ADD COLUMN "whenDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenPpWeek" INTEGER,
  ADD COLUMN "whenOrds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenCycleUnit" TEXT,
  ADD COLUMN "whenCycleN" INTEGER,
  ADD COLUMN "whenCycleOffset" INTEGER;

UPDATE "availability_rules" SET
  "whenDays" = ARRAY["dayOfWeek"],
  "whenKind" = CASE "pattern"
    WHEN 'pp_week_1' THEN 'ppWeek'
    WHEN 'pp_week_2' THEN 'ppWeek'
    WHEN 'every_n'   THEN 'cycle'
    ELSE 'every' END,
  "whenPpWeek" = CASE "pattern" WHEN 'pp_week_1' THEN 1 WHEN 'pp_week_2' THEN 2 ELSE NULL END,
  "whenCycleUnit"   = CASE WHEN "pattern" = 'every_n' THEN 'week' ELSE NULL END,
  -- COALESCE preserves legacy matchesPattern defaults (cycleLength??2, cycleOffset??0)
  "whenCycleN"      = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleLength", 2) ELSE NULL END,
  "whenCycleOffset" = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleOffset", 0) ELSE NULL END;

-- ── shift_eligibility_rules ──
ALTER TABLE "shift_eligibility_rules"
  ADD COLUMN "whenKind" TEXT,
  ADD COLUMN "whenDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenPpWeek" INTEGER,
  ADD COLUMN "whenOrds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenCycleUnit" TEXT,
  ADD COLUMN "whenCycleN" INTEGER,
  ADD COLUMN "whenCycleOffset" INTEGER;

UPDATE "shift_eligibility_rules" SET
  "whenDays" = ARRAY["dayOfWeek"],
  "whenKind" = CASE "pattern"
    WHEN 'pp_week_1' THEN 'ppWeek'
    WHEN 'pp_week_2' THEN 'ppWeek'
    WHEN 'every_n'   THEN 'cycle'
    ELSE 'every' END,
  "whenPpWeek" = CASE "pattern" WHEN 'pp_week_1' THEN 1 WHEN 'pp_week_2' THEN 2 ELSE NULL END,
  "whenCycleUnit"   = CASE WHEN "pattern" = 'every_n' THEN 'week' ELSE NULL END,
  "whenCycleN"      = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleLength", 2) ELSE NULL END,
  "whenCycleOffset" = CASE WHEN "pattern" = 'every_n' THEN COALESCE("cycleOffset", 0) ELSE NULL END;

-- ── employment_type_default_availability (no cycle: only every / pp_week_1 / pp_week_2) ──
ALTER TABLE "employment_type_default_availability"
  ADD COLUMN "whenKind" TEXT,
  ADD COLUMN "whenDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenPpWeek" INTEGER,
  ADD COLUMN "whenOrds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "whenCycleUnit" TEXT,
  ADD COLUMN "whenCycleN" INTEGER,
  ADD COLUMN "whenCycleOffset" INTEGER;

UPDATE "employment_type_default_availability" SET
  "whenDays" = ARRAY["dayOfWeek"],
  "whenKind" = CASE "pattern"
    WHEN 'pp_week_1' THEN 'ppWeek'
    WHEN 'pp_week_2' THEN 'ppWeek'
    ELSE 'every' END,
  "whenPpWeek" = CASE "pattern" WHEN 'pp_week_1' THEN 1 WHEN 'pp_week_2' THEN 2 ELSE NULL END;
