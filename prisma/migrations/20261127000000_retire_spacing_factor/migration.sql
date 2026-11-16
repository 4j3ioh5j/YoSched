-- Card #293: the Spacing factor and its trial are retired (David's decision, 2026-11-16: the trial
-- cost seconds per generate and did not space shifts better than "Spread across the month").
-- Removes the Spacing row and closes the gap it leaves in sortOrder, so the six remaining factors
-- keep their order. Saved profiles that still list "spacing" drop it when applied (unknown keys
-- are ignored by reconcileOrder); the engine ignores a stale spacing row anyway.
-- Idempotent: with no spacing row both statements change nothing. The file is its own
-- transaction (Prisma 7 does not wrap it).
--
-- ROLLBACK: code-only. The 0.595.x engine accepts the six rows and places Spacing below Requests
-- and Over hours itself (card #285), so no data has to come back. To bring the row back as well
-- (a live write; only with David's yes): re-insert it directly below Over hours, e.g.
--   BEGIN;
--   UPDATE "autogen_factors" SET "sortOrder" = "sortOrder" + 1
--    WHERE "sortOrder" > (SELECT "sortOrder" FROM "autogen_factors" WHERE "key" = 'overHours');
--   INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness", "hoursPolicy")
--     SELECT 'agf_spacing', 'spacing', 'Spacing between the same shift', "sortOrder" + 1, true, 'soft', NULL
--       FROM "autogen_factors" WHERE "key" = 'overHours';
--   COMMIT;
BEGIN;
UPDATE "autogen_factors" AS f
   SET "sortOrder" = f."sortOrder" - 1
  FROM "autogen_factors" AS s
 WHERE s."key" = 'spacing' AND f."sortOrder" > s."sortOrder";
DELETE FROM "autogen_factors" WHERE "key" = 'spacing';
COMMIT;
