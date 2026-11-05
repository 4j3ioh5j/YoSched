-- Phase B: "Maximum per day" now lives in Staffing Rules (staffing_requirements.maxCount,
-- 20261106000000_staffing_max_count). Nothing reads or writes shift_types.maxPerDay.
-- Rollback (non-destructive): prisma/rollback/20261106010000_restore_max_per_day.sql
ALTER TABLE "shift_types" DROP COLUMN "maxPerDay";
