-- Admin-level carveout for the Auto-Generation Priority section (#252 follow-up).
-- The new "settings:autogen-priority" permission gates editing the priority order +
-- profiles. Grant it to the full-access system groups (Admin = level 3, Super User =
-- level 2) so they keep edit access; Scheduler (level 1) intentionally loses it.
-- Idempotent: skips groups that already have the key. Fresh installs get it via the seed
-- (Admin/Super User are seeded with the whole permission catalog).
UPDATE "groups"
   SET "permissions" = array_append("permissions", 'settings:autogen-priority')
 WHERE "level" >= 2
   AND NOT ('settings:autogen-priority' = ANY("permissions"));
