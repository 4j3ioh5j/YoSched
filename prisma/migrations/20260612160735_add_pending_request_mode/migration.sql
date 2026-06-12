-- Auto-scheduler handling of PENDING (unapproved) requests: "off" | "soft" | "full".
-- Additive, NOT NULL with a default so existing rows backfill to the chosen default.
-- Default "full" = pending requests are honored at their declared strength (the
-- conflict/rule-break flagging that ships alongside keeps this safe).
ALTER TABLE "scheduling_preferences" ADD COLUMN "pendingRequestMode" TEXT NOT NULL DEFAULT 'full';
