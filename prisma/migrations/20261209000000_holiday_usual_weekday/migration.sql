-- Card #349: the usual-weekday share (%) for holiday pay (additive; old code ignores it).
-- Rollback: code-only. To remove: ALTER TABLE "scheduling_preferences" DROP COLUMN "holidayUsualWeekdayPct";
ALTER TABLE "scheduling_preferences" ADD COLUMN "holidayUsualWeekdayPct" INTEGER NOT NULL DEFAULT 60;
