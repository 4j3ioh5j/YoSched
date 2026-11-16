-- Card #289: Spacing goes below Over hours (David's #58, card #285). The card #266 migration
-- puts Spacing directly after Requests; on an install where Over hours comes right after
-- Requests that is above Over hours. Live already has Spacing below Over hours (David moved it),
-- so there this is a no-op. It matters after a whole-card-266 rollback plus redeploy, which
-- re-applies the #266 migration: this one then runs after it and moves Spacing back below.
--
-- It changes only that exact shape (Requests, Spacing, Over hours in a row): any other order
-- someone chose is left alone. Adjacent rows, so swapping their sortOrder moves nothing else.
-- Idempotent; the file is its own transaction (Prisma 7 does not wrap it).
--
-- ROLLBACK of this card alone: code-only (a reorder of existing rows; nothing reads a new value).
-- ROLLBACK of the whole card #266 (a live write; only with David's yes), run BEFORE reverting the
-- code. It replaces the rollback in the #266 migration's comment: it also forgets THIS migration,
-- so a later redeploy re-applies both in order:
--   BEGIN;
--   UPDATE "autogen_factors" SET "sortOrder" = "sortOrder" - 1
--    WHERE "sortOrder" > (SELECT "sortOrder" FROM "autogen_factors" WHERE "key" = 'spacing');
--   DELETE FROM "autogen_factors" WHERE "key" = 'spacing';
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" IN
--     ('20261125000000_autogen_spacing_factor', '20261126000000_spacing_below_over_hours');
--   COMMIT;
BEGIN;
UPDATE "autogen_factors" AS f
   SET "sortOrder" = CASE f."key" WHEN 'spacing' THEN o."sortOrder" ELSE s."sortOrder" END
  FROM "autogen_factors" AS s, "autogen_factors" AS o, "autogen_factors" AS r
 WHERE s."key" = 'spacing' AND o."key" = 'overHours' AND r."key" = 'requests'
   AND s."sortOrder" = r."sortOrder" + 1 AND o."sortOrder" = s."sortOrder" + 1
   AND (SELECT count(*) FROM "autogen_factors" x WHERE x."sortOrder" IN (s."sortOrder", o."sortOrder")) = 2
   AND f."key" IN ('spacing', 'overHours');
COMMIT;
