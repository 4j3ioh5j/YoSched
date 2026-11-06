-- Phase B of "Printed-schedule columns follow the shift, not its code" (card #48). Phase A (20261106090000) gave every shift
-- condition of print_column_rules and print_aggregate_columns "shiftTypeIds" / "exceptIds" and kept the code keys ("codes" /
-- "except") and print_column_rules' legacy selector ("shiftCodes" / "shiftMatch") only as trigger-derived compat for a pre-A
-- build. Phase A is deployed and verified; nothing reads or writes them any more (every reader derives the shifts' current
-- codes from shift_types in code via deriveConditionCodes; the grid and the matcher work on ids). Drop the TEMPORARY bridge
-- (the three sync triggers), strip the code keys from every condition and drop the two legacy columns. The PERMANENT
-- validator and delete-guard triggers and the print_* helper functions stay: they are the jsonb's stand-in for a foreign key.
-- Rollback (non-destructive, re-runnable): prisma/rollback/20261106100000_restore_print_conditions_codes.sql

-- Belt and braces: fold a legacy selector written AFTER Phase A (only a pre-A build in a rollback window could) into
-- conditions, exactly as Phase A did; the still-present bridge trigger fills the ids. Normally no row matches.
UPDATE "print_column_rules"
   SET conditions = jsonb_build_array(jsonb_build_object(
         'quantifier', CASE WHEN "shiftMatch" = 'all' THEN 'has_all' ELSE 'has_any' END,
         'categories', '[]'::jsonb,
         'codes', to_jsonb("shiftCodes"),
         'except', '[]'::jsonb))
 WHERE jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) = 0 AND cardinality("shiftCodes") > 0;

DROP TRIGGER IF EXISTS print_column_rules_1_sync_conditions ON "print_column_rules";
DROP TRIGGER IF EXISTS print_aggregate_columns_1_sync_conditions ON "print_aggregate_columns";
DROP FUNCTION IF EXISTS print_conditions_sync_trigger();
DROP TRIGGER IF EXISTS shift_types_sync_print_codes ON "shift_types";
DROP FUNCTION IF EXISTS shift_types_sync_print_codes();

-- Strip the compat keys from every condition object (non-object elements and non-array values are left as they are).
UPDATE "print_column_rules" SET conditions = (
  SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' THEN e - 'codes' - 'except' ELSE e END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(conditions) WITH ORDINALITY x(e, ord))
 WHERE jsonb_typeof(conditions) = 'array';
UPDATE "print_aggregate_columns" SET conditions = (
  SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' THEN e - 'codes' - 'except' ELSE e END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(conditions) WITH ORDINALITY x(e, ord))
 WHERE jsonb_typeof(conditions) = 'array';

ALTER TABLE "print_column_rules" DROP COLUMN "shiftCodes", DROP COLUMN "shiftMatch";
