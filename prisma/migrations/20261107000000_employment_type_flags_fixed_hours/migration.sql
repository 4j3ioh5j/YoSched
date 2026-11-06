-- Card #71: FTE % only for types that use it; fixed hours per pay period; fairness by setting.
-- Additive: old code never reads the new columns.
-- One-off initialisation: the old UI rule ("the FTE box shows only for the type named FTE") becomes a
-- setting. No code reads the type name afterwards.
-- Rollback is code-only (redeploy the previous commit; keep these columns): prisma/rollback/20261107000000_employment_type_flags_code_only.sql
ALTER TABLE "employment_types"
  ADD COLUMN "usesFtePercentage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowsFixedHours" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "includedInFairness" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "staff" ADD COLUMN "fixedHoursPerPp" DOUBLE PRECISION;

UPDATE "employment_types" SET "usesFtePercentage" = ("name" = 'FTE'),
                              "includedInFairness" = ("name" = 'FTE');
UPDATE "employment_types" SET "allowsFixedHours" = NOT "usesFtePercentage";

-- Staff of a type without an FTE % store 0 (old code then also gives them no hours target).
UPDATE "staff" s SET "ftePercentage" = 0
  FROM "employment_types" t
 WHERE s."employmentTypeId" = t."id" AND NOT t."usesFtePercentage"
   AND s."ftePercentage" IS DISTINCT FROM 0;
