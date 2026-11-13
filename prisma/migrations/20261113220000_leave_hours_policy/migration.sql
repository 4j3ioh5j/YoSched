-- Card #175: how requested leave is charged. "up-to-target" (default): leave only on
-- days the person would work and never past their pay-period target (other leave
-- days become the off shift). "always": leave on every requested day (pre-#175).
-- Additive with a default: old code ignores the column; rollback is code-only.
ALTER TABLE "scheduling_preferences" ADD COLUMN "leaveHoursPolicy" TEXT NOT NULL DEFAULT 'up-to-target';
