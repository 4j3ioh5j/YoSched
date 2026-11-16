-- Card #301: printed schedule layout settings. Additive; existing rows keep their values.
ALTER TABLE "scheduling_preferences" ADD COLUMN "printHeader" JSONB;
ALTER TABLE "scheduling_preferences" ADD COLUMN "printFooter" JSONB;
ALTER TABLE "scheduling_preferences" ADD COLUMN "printFontFamily" TEXT NOT NULL DEFAULT 'Aptos Narrow';
ALTER TABLE "scheduling_preferences" ADD COLUMN "printFontSize" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "scheduling_preferences" ADD COLUMN "splitDateDayColumns" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "scheduling_preferences" ADD COLUMN "dateColumnFormat" TEXT NOT NULL DEFAULT 'MM-DD';
ALTER TABLE "scheduling_preferences" ADD COLUMN "dayColumnFormat" TEXT NOT NULL DEFAULT 'DDD';
ALTER TABLE "scheduling_preferences" ADD COLUMN "printPayPeriodLabels" BOOLEAN NOT NULL DEFAULT true;
-- New installs start with print weekend/holiday shading off (matches the MD Schedule PDF).
ALTER TABLE "scheduling_preferences" ALTER COLUMN "printWeekendColor" DROP DEFAULT;
ALTER TABLE "scheduling_preferences" ALTER COLUMN "printHolidayColor" DROP DEFAULT;
