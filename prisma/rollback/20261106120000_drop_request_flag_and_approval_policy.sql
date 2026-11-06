-- Rollback of 20261106120000_request_flag_and_approval_policy (card #67). Re-runnable.
--
-- A CODE-ONLY rollback (git revert / redeploy of 8b0dbea) must NOT run this file: the columns
-- are additive and nullable/defaulted, the old code never reads them, and dropping them while
-- the migration stays recorded in _prisma_migrations makes the next `prisma migrate deploy`
-- fail (it believes the columns exist). Run this ONLY when also removing the migration row:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261106120000_request_flag_and_approval_policy';
ALTER TABLE "schedule_requests" DROP COLUMN IF EXISTS "flaggedAt", DROP COLUMN IF EXISTS "flaggedReason";
ALTER TABLE "scheduling_preferences" DROP COLUMN IF EXISTS "approvalConflictPolicy";
