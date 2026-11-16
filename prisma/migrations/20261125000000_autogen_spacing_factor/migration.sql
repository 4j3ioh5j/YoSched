-- Card #266: the "spacing" auto-generate factor, directly after "requests" (David's #52).
-- sortOrder is an Int with no unique index, so the rows after requests move down by one and
-- spacing takes requests + 1 (requests missing: appended at max + 1). Idempotent: a no-op
-- when a spacing row exists. Prisma 7 does NOT apply a migration file atomically (checked on a
-- throwaway cluster), so the file is its own transaction.
--
-- Live result: hardLimits 0, coverage 1, underHours 2, requests 3, spacing 4, overHours 5,
-- fairness 6 (policies untouched). A fresh install gets DEFAULT_FACTOR_ORDER.
--
-- ROLLBACK (a live write; only with David's yes), run BEFORE reverting the code. It also forgets
-- this migration in Prisma's ledger so a later redeploy re-applies it:
--   BEGIN;
--   UPDATE "autogen_factors" SET "sortOrder" = "sortOrder" - 1
--    WHERE "sortOrder" > (SELECT "sortOrder" FROM "autogen_factors" WHERE "key" = 'spacing');
--   DELETE FROM "autogen_factors" WHERE "key" = 'spacing';
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261125000000_autogen_spacing_factor';
--   COMMIT;
BEGIN;
UPDATE "autogen_factors" SET "sortOrder" = "sortOrder" + 1
 WHERE "sortOrder" > (SELECT "sortOrder" FROM "autogen_factors" WHERE "key" = 'requests')
   AND NOT EXISTS (SELECT 1 FROM "autogen_factors" WHERE "key" = 'spacing');
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness", "hoursPolicy")
SELECT 'agf_spacing', 'spacing', 'Spacing between the same shift',
       COALESCE((SELECT "sortOrder" + 1 FROM "autogen_factors" WHERE "key" = 'requests'),
                (SELECT COALESCE(MAX("sortOrder"), -1) + 1 FROM "autogen_factors")),
       true, 'soft', NULL
 WHERE NOT EXISTS (SELECT 1 FROM "autogen_factors" WHERE "key" = 'spacing');
COMMIT;
