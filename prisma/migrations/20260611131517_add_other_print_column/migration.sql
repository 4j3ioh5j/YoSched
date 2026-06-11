-- "OTHER" print column: collapse fee-basis (and any so-flagged) staff into a single
-- column on the PRINTED schedule. Two additive columns:
--   - scheduling_preferences.collapseOtherOnPrint : the single global on/off (default true)
--   - employment_types.collapsesIntoOther          : which employment types collapse
-- Runtime logic reads collapsesIntoOther (never the type name); the one-time backfill below
-- seeds the "Fee Basis" type so existing rows collapse out of the box (mirrors the
-- boldOnSchedule migration pattern). Both columns are additive — no row rewrite.

ALTER TABLE "scheduling_preferences" ADD COLUMN "collapseOtherOnPrint" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "employment_types" ADD COLUMN "collapsesIntoOther" BOOLEAN NOT NULL DEFAULT false;

UPDATE "employment_types" SET "collapsesIntoOther" = true WHERE "name" = 'Fee Basis';
