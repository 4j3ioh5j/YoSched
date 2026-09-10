-- Configurable staff column ordering for the schedule (screen + print). Stores an
-- ordered criteria stack [{key, dir?}] validated by src/lib/staff-order.ts; NULL
-- means the built-in default (employment type → FTE% desc → alphabetical), so no
-- backfill is needed and existing installs pick up the new default order on deploy.
ALTER TABLE "scheduling_preferences" ADD COLUMN "staffColumnOrder" JSONB;
