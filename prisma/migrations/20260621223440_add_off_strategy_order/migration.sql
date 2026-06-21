-- Day-off fulfillment-strategy ordering. A requested day off can be produced
-- several ways at different leave-pool cost; these ordered columns capture the
-- preferred sequence the engine (slices 2-3) will try. Additive + default-valued,
-- so existing rows backfill to the empty/default order with no behavior change.
-- Tokens: 'ORC_ADJACENT' | 'ORL_PAIR' | 'LEAVE:<shiftTypeId>'.

-- Per-request resolved order (snapshotted at submit; empty = no preference).
ALTER TABLE "schedule_requests" ADD COLUMN "offStrategyOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Per-staff default; empty = inherit the department default below.
ALTER TABLE "staff" ADD COLUMN "offStrategyOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Department-wide default; admin appends LEAVE:<shiftTypeId> tokens.
ALTER TABLE "scheduling_preferences" ADD COLUMN "defaultOffStrategyOrder" TEXT[] NOT NULL DEFAULT ARRAY['ORC_ADJACENT', 'ORL_PAIR']::TEXT[];
