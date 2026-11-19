-- Card #357: print width choices for the user-defined columns. Additive with defaults, so the
-- old code ignores the columns and rollback is code-only.
-- Rollback: code-only. To remove: ALTER TABLE "scheduling_preferences" DROP COLUMN "printUdWidthMode", DROP COLUMN "printUdWidthHundredths", DROP COLUMN "printUdColumnWidths";
ALTER TABLE "scheduling_preferences" ADD COLUMN "printUdWidthMode" TEXT NOT NULL DEFAULT 'bestFit';
ALTER TABLE "scheduling_preferences" ADD COLUMN "printUdWidthHundredths" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "scheduling_preferences" ADD COLUMN "printUdColumnWidths" JSONB NOT NULL DEFAULT '{}';
