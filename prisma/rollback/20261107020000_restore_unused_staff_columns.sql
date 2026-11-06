-- Rollback of 20261107020000_drop_unused_staff_columns (card #72). Re-runnable.
-- Restores both columns exactly as before (nullable, no default). They held no data, so nothing is lost.
-- ORDER: run this file FIRST, then redeploy the older code (178c897 or earlier): the older Prisma
-- client selects these columns on every staff read and fails while they are missing.
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "fteSplit" JSONB, ADD COLUMN IF NOT EXISTS "feeBasisHoursPerShift" DOUBLE PRECISION;
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107020000_drop_unused_staff_columns';
