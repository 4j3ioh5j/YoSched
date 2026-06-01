-- Grant the new statistics:manage permission to existing privileged groups.
-- Admin / Super User get every permission; Scheduler gains it too. Staff does not.
-- array_append is guarded so re-running is a no-op (idempotent).
UPDATE "groups"
SET "permissions" = array_append("permissions", 'statistics:manage')
WHERE "name" IN ('Admin', 'Super User', 'Scheduler')
  AND NOT ('statistics:manage' = ANY("permissions"));
