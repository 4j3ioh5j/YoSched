-- Card #215: scheduler tuning numbers become Settings values. Additive with the values the
-- engine always used as defaults, so nothing changes until someone edits them. Rollback is
-- code-only (older code never reads these columns).
ALTER TABLE "scheduling_preferences"
  ADD COLUMN "spreadRadiusDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "evenBandCalls" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "softRequestOffWeight" DOUBLE PRECISION NOT NULL DEFAULT 5,
  ADD COLUMN "softAvoidFollowWeight" DOUBLE PRECISION NOT NULL DEFAULT 5,
  ADD COLUMN "scarcePoolSize" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "weekendStartDow" INTEGER NOT NULL DEFAULT 6;
