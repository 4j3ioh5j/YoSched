-- Preferred (safe) headcount per shift/day for the auto-scheduler's day-balance
-- tier: a discretionary day off avoids dates whose projected count for the fill
-- shift would fall below this. 0 = no preference (legacy behavior). Existing rows
-- take the default.
ALTER TABLE "staffing_requirements" ADD COLUMN "preferredCount" INTEGER NOT NULL DEFAULT 0;
