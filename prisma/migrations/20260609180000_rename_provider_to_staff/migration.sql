-- Rename the staff entity and its child tables + every providerId FK column from
-- the legacy "provider" naming to "staff". These are pure metadata renames:
-- Postgres rewrites no row data and automatically repoints all foreign keys,
-- indexes, and unique constraints to follow each rename. One transaction — it
-- all applies or nothing does. Constraint/index *names* keep their old spelling
-- (e.g. providers_pkey); harmless — the Prisma client addresses columns/tables,
-- never constraint names.

-- 1) Tables
ALTER TABLE "providers" RENAME TO "staff";
ALTER TABLE "provider_shift_overrides" RENAME TO "staff_shift_overrides";
ALTER TABLE "provider_day_preferences" RENAME TO "staff_day_preferences";
ALTER TABLE "provider_eligible_shifts" RENAME TO "staff_eligible_shifts";

-- 2) FK columns providerId -> staffId (using post-rename table names)
ALTER TABLE "users" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "staff_shift_overrides" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "staff_day_preferences" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "staff_eligible_shifts" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "standing_commitments" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "assignments" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "shift_eligibility_rules" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "shift_minimum_targets" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "schedule_requests" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "availability_rules" RENAME COLUMN "providerId" TO "staffId";
ALTER TABLE "availability_rules" RENAME COLUMN "conditionProviderId" TO "conditionStaffId";

-- 3) Data: schedule_versions.snapshot is a jsonb AssignmentSnapshot[] with a
-- per-element "providerId" key. The column renames above do NOT touch jsonb
-- contents, so pre-rename snapshots would still carry providerId while the
-- renamed restore/diff code reads staffId — breaking restore of old versions.
-- Rewrite each element's providerId -> staffId (order preserved). The content
-- hash (snapshotHash) is value-based and key-name-insensitive, so it is
-- unchanged and needs no recompute.
UPDATE "schedule_versions" sv
SET "snapshot" = sub.fixed
FROM (
  SELECT v.id,
         jsonb_agg(
           CASE WHEN elem ? 'providerId'
                THEN (elem - 'providerId') || jsonb_build_object('staffId', elem->'providerId')
                ELSE elem END
           ORDER BY ord
         ) AS fixed
  FROM "schedule_versions" v,
       jsonb_array_elements(v."snapshot") WITH ORDINALITY AS t(elem, ord)
  GROUP BY v.id
) sub
WHERE sv.id = sub.id
  AND sv."snapshot"::text LIKE '%providerId%';
