-- Per-shift-type flag: does working this shift on a holiday count toward the
-- holiday-burden equity metric? Default true preserves prior behavior (every
-- worked, non-leave/non-off shift on a holiday counts). Departments can uncheck
-- shifts that should not count as holiday work.
ALTER TABLE "shift_types" ADD COLUMN "countsAsHolidayWork" BOOLEAN NOT NULL DEFAULT true;
