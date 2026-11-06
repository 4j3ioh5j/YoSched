-- Card #75: department defaults for the "turn a shift's Auto-schedule on" panel. Additive.
ALTER TABLE "scheduling_preferences" ADD COLUMN "activationWorkedDefault" TEXT NOT NULL DEFAULT 'eligible';
ALTER TABLE "scheduling_preferences" ADD COLUMN "activationNeverDefault" TEXT NOT NULL DEFAULT 'not_eligible';
ALTER TABLE "scheduling_preferences" ADD COLUMN "activationNewHireDefault" TEXT NOT NULL DEFAULT 'keep';
