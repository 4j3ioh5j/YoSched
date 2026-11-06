-- Rollback of 20261107030000_request_approval_ripple (card #70) is CODE-ONLY: redeploy the
-- previous commit and KEEP the column. It is additive and nullable, older code never reads it,
-- and dropping it while the migration row stays in _prisma_migrations breaks the next
-- `prisma migrate deploy`. Only if the column must really go, run BOTH, together:
--   ALTER TABLE "schedule_requests" DROP COLUMN IF EXISTS "approvalRipple";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107030000_request_approval_ripple';
SELECT count(*) FILTER (WHERE "approvalRipple" IS NOT NULL) AS approvals_with_ripple FROM "schedule_requests";
