-- A request's approval can be derived from the schedule (a satisfying assignment
-- exists for every covered day) or set deliberately by a human/scheduler.
-- autoApproved=true marks the former: it is auto-reverted to pending if the
-- satisfying assignment is later removed or changed. Sticky human approvals
-- (multi-option REQUEST_SHIFT / NEGATE_SHIFT, or any manual override) stay false
-- and are never auto-reverted. Default false preserves all existing rows as
-- sticky.
ALTER TABLE "schedule_requests" ADD COLUMN "autoApproved" BOOLEAN NOT NULL DEFAULT false;
