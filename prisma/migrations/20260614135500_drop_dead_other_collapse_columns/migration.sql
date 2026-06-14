-- Drop the two dead columns from the original hardcoded "OTHER" print-collapse feature
-- (migration 20260611131517_add_other_print_column). That mechanism was superseded by
-- the configurable PrintAggregateColumn system (isOther catch-all column); nothing in the
-- print/grid rendering reads these anymore. Removing the orphaned schema + plumbing.
--   - employment_types.collapsesIntoOther
--   - scheduling_preferences.collapseOtherOnPrint
ALTER TABLE "employment_types" DROP COLUMN "collapsesIntoOther";
ALTER TABLE "scheduling_preferences" DROP COLUMN "collapseOtherOnPrint";
