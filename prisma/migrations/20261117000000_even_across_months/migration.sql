-- Card #203: "Keep counts even across months" (additive; old code ignores all three).
ALTER TABLE "shift_types" ADD COLUMN "evenAcrossMonths" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "scheduling_preferences" ADD COLUMN "shiftBalanceFrom" DATE;
-- When a shift was ticked for a person. Existing rows stay NULL (their real start is unknown =
-- no limit); the default is set AFTER the column exists so only new ticks get the time.
ALTER TABLE "staff_eligible_shifts" ADD COLUMN "eligibleSince" TIMESTAMP(3);
ALTER TABLE "staff_eligible_shifts" ALTER COLUMN "eligibleSince" SET DEFAULT CURRENT_TIMESTAMP;
