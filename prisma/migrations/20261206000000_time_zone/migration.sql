-- Card #320: one time zone for the whole app. Additive, nullable: null behaves exactly like
-- before (UTC), so the deploy changes nothing until the admin picks a zone in Settings.
-- Rollback: set the zone back to UTC in Settings first (that converts the backup time back),
-- then deploy the old code, which ignores this column.
ALTER TABLE "scheduling_preferences" ADD COLUMN "timeZone" TEXT;
