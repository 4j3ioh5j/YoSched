-- Rollback for migration 20261106010000_drop_shift_types_max_per_day.
-- Re-creates shift_types."maxPerDay" from Staffing Rules Max, without touching any
-- other data. MAX over the day keys, so a per-day difference never makes the old
-- column stricter than the rules it replaced (NULL Max rows are ignored by MAX; a
-- shift with no Max on any day gets NULL = no limit). It also forgets the migration
-- in Prisma's history (`prisma migrate resolve --rolled-back` only accepts FAILED
-- migrations, P3012), so a later deploy of Phase B re-applies it.
-- Re-runnable. After it, deploy the Phase A commit (bd35163), which never reads the column.
BEGIN;
ALTER TABLE "shift_types" ADD COLUMN IF NOT EXISTS "maxPerDay" INTEGER;
UPDATE "shift_types" st
-- Joined by the shift's id (staffing_requirements."shiftCode" was dropped in 20261106040000).
SET "maxPerDay" = (SELECT MAX(sr."maxCount") FROM "staffing_requirements" sr WHERE sr."shiftTypeId" = st."id");
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106010000_drop_shift_types_max_per_day';
COMMIT;
