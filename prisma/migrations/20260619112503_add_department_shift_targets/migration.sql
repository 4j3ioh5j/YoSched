-- Department-wide shift count targets ("Pay-period preferences").
-- Same min/max + window shape as shift_minimum_targets, but NOT keyed to a staff
-- member: each row is a default applying to everyone, with counts expressed per
-- 1.0 FTE (perFte) and scaled to each staff's ftePercentage at schedule time.
-- A per-staff shift_minimum_targets row for the same (shiftType, window,
-- windowCount) overrides the department default. `strength` distinguishes a soft
-- preference (bias only) from a hard rule.
CREATE TABLE "department_shift_targets" (
    "id" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL,
    "maxCount" INTEGER,
    "window" TEXT NOT NULL,
    "windowDays" INTEGER,
    "windowCount" INTEGER NOT NULL DEFAULT 1,
    "strength" TEXT NOT NULL DEFAULT 'preference',
    "perFte" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "department_shift_targets_pkey" PRIMARY KEY ("id")
);

-- One target per (shift, window, windowCount) — mirrors the per-staff uniqueness
-- minus the staff key, so a shift can hold e.g. "2 per pay period" and
-- "1 per 3 pay periods" simultaneously.
CREATE UNIQUE INDEX "dept_shift_targets_shift_window_count_key" ON "department_shift_targets"("shiftTypeId", "window", "windowCount");

ALTER TABLE "department_shift_targets" ADD CONSTRAINT "department_shift_targets_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
