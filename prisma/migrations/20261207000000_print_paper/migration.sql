-- Card #323: paper size and margin for the printout and the year PDF (additive; old code ignores them).
-- Rollback: code-only. To remove: ALTER TABLE "scheduling_preferences" DROP COLUMN "printPaperSize", DROP COLUMN "printMarginHundredthsIn";
ALTER TABLE "scheduling_preferences" ADD COLUMN "printPaperSize" TEXT NOT NULL DEFAULT 'letter';
ALTER TABLE "scheduling_preferences" ADD COLUMN "printMarginHundredthsIn" INTEGER NOT NULL DEFAULT 25;
