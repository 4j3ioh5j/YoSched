-- Add "per N windows" multiplier to shift minimum/maximum targets.
-- windowCount tiles the calendar into fixed, non-overlapping blocks of N
-- (e.g. 1 per 3 pay periods) for week/pay_period/month windows; it is ignored
-- for the rolling "days" window. Defaults to 1, so existing targets keep their
-- single-window meaning.
ALTER TABLE "shift_minimum_targets" ADD COLUMN "windowCount" INTEGER NOT NULL DEFAULT 1;

-- Extend the per-(staff, shift, window) uniqueness to include windowCount, so a
-- staff can hold e.g. "1 per pay period" and "1 per 3 pay periods" for the same
-- shift. The original index was created as "..._providerId_..." and the
-- Provider->Staff column rename did NOT rename it, so drop either name defensively.
DROP INDEX IF EXISTS "shift_minimum_targets_providerId_shiftTypeId_window_key";
DROP INDEX IF EXISTS "shift_minimum_targets_staffId_shiftTypeId_window_key";
CREATE UNIQUE INDEX "shift_min_targets_staff_shift_window_count_key" ON "shift_minimum_targets"("staffId", "shiftTypeId", "window", "windowCount");
