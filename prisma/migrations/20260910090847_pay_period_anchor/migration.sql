-- Pay periods become derived from an anchor + length instead of a manually counted
-- list. The anchor is any real period start; the app regenerates/extends the
-- pay_periods table from it automatically (rolling coverage window), with all date
-- math in whole UTC days — fixing the DST bug that produced 13- and 15-day periods
-- around Mar 8 / Oct 31, 2026 and shifted every date between them by one day.

ALTER TABLE "scheduling_preferences" ADD COLUMN "payPeriodAnchor" DATE;
ALTER TABLE "scheduling_preferences" ADD COLUMN "payPeriodLengthDays" INTEGER NOT NULL DEFAULT 14;

-- Backfill for existing installs: the earliest stored period start IS the ladder
-- base (it was the user-entered start generated with offset 0, untouched by the
-- DST drift that corrupted later rows), so adopt it as the anchor. No-op when no
-- periods exist. Ensure a prefs row exists to carry the anchor.
INSERT INTO "scheduling_preferences" ("id")
SELECT 'default'
 WHERE NOT EXISTS (SELECT 1 FROM "scheduling_preferences")
   AND EXISTS (SELECT 1 FROM "pay_periods");

UPDATE "scheduling_preferences"
   SET "payPeriodAnchor" = (SELECT MIN("startDate") FROM "pay_periods")
 WHERE "payPeriodAnchor" IS NULL;
