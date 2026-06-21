-- Stamps each source="auto" assignment with the "YYYY-MM" calendar month its
-- Auto-schedule run targeted, so "Clear Auto" of a month can remove that
-- month's cells AND its overflow into neighbouring months by origin (a run
-- expands to whole pay periods, spilling cells past the month edge).
--
-- Nullable on purpose: manual/imported rows and auto rows written before this
-- column existed stay NULL and fall back to the existing month-range clear.
-- No backfill needed.
ALTER TABLE "assignments" ADD COLUMN "autoMonth" TEXT;

-- CreateIndex
CREATE INDEX "assignments_autoMonth_idx" ON "assignments"("autoMonth");
