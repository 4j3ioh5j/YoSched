-- Auto-scheduler holiday policy: who is owed HOL on a holiday — "entitlement"
-- (scheduled-workday rule, counts toward the pay-period target), "fill" (legacy:
-- only when the hours fill lands on the holiday) or "none" (never auto-placed).
-- Validated by src/lib/holiday-policy.ts; existing rows take the new default.
ALTER TABLE "scheduling_preferences" ADD COLUMN "holidayPolicy" TEXT NOT NULL DEFAULT 'entitlement';
