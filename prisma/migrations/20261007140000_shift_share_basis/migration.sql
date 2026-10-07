-- Auto-scheduler shift share basis: how slots of a scheduled shift (CALL/ORC/ORL…)
-- are split across eligible staff within a run — "fte" (proportional to FTE) or
-- "head" (equal per person, the previous behavior). Validated by
-- src/lib/shift-share.ts; existing rows take the new default.
ALTER TABLE "scheduling_preferences" ADD COLUMN "shiftShareBasis" TEXT NOT NULL DEFAULT 'fte';
