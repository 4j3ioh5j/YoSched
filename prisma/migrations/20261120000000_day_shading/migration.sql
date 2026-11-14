-- Card #209: weekend/holiday shading colours as settings (null = no shading). Additive;
-- the defaults fill the existing row. Rollback is code-only (old code ignores them).
ALTER TABLE "scheduling_preferences" ADD COLUMN "printWeekendColor" TEXT DEFAULT '#EBEBEB';
ALTER TABLE "scheduling_preferences" ADD COLUMN "printHolidayColor" TEXT DEFAULT '#D0D0D0';
ALTER TABLE "scheduling_preferences" ADD COLUMN "screenHolidayColor" TEXT DEFAULT '#4A3410';
