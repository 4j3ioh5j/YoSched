-- Rollback for 20261107010000_staff_fte_no_default (card #71 Phase B). Re-runnable.
-- Restores the column default exactly; touches no data, so no value can change in a round trip.
-- Deleting the migration row lets a later redeploy re-apply the migration.
ALTER TABLE "staff" ALTER COLUMN "ftePercentage" SET DEFAULT 1.0;
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261107010000_staff_fte_no_default';
