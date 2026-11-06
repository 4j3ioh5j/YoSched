-- Card #70: an approval records what it changed on other staff's cells, so Undo can put it back.
-- Additive, nullable. Rollback is CODE-ONLY (older code never reads or writes it); keep the column.
-- prisma/rollback/20261107030000_request_approval_ripple_code_only.sql
ALTER TABLE "schedule_requests" ADD COLUMN "approvalRipple" JSONB;
