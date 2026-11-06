-- Card #67: approving a request on a full day resolves it or flags it.
-- schedule_requests: an approval that cannot be honoured without breaking a hard rule places nothing and
-- leaves the request pending with the reason here (both NULL = not flagged).
-- scheduling_preferences: how such an approval is handled — "resolve-pp" (re-arrange the day, then the
-- covering pay period), "resolve-day" (the day only) or "flag" (never move anyone).
-- Additive and nullable/defaulted: old code never reads these columns.
-- Rollback (re-runnable): prisma/rollback/20261106120000_drop_request_flag_and_approval_policy.sql
ALTER TABLE "schedule_requests" ADD COLUMN "flaggedAt" TIMESTAMP(3), ADD COLUMN "flaggedReason" TEXT;
ALTER TABLE "scheduling_preferences" ADD COLUMN "approvalConflictPolicy" TEXT NOT NULL DEFAULT 'resolve-pp';
