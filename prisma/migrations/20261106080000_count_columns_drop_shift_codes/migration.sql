-- Phase B of "Count Columns follow the shift, not its code" (card #48). Phase A (20261106070000) linked count_columns to
-- shift_types.id ("shiftTypeIds") and kept "shiftCodes" only as a trigger-derived compat array for a pre-A build. Phase A is
-- deployed and verified; nothing reads or writes the column any more (every reader derives the shifts' current codes from
-- shift_types in code via deriveCountColumnCodes, and the grid counts by shiftTypeId). Drop the TEMPORARY bridge (triggers 1
-- and 4) and the column. The two PERMANENT triggers (count_columns_2_check_shift_ids, shift_types_block_delete_count_column)
-- stay: they are the array's stand-in for a foreign key.
-- Rollback (non-destructive, re-runnable): prisma/rollback/20261106080000_restore_count_columns_shift_codes.sql
DROP TRIGGER IF EXISTS count_columns_1_sync_keys ON "count_columns";
DROP FUNCTION IF EXISTS count_columns_sync_keys();
DROP TRIGGER IF EXISTS shift_types_sync_count_codes ON "shift_types";
DROP FUNCTION IF EXISTS shift_types_sync_count_codes();
ALTER TABLE "count_columns" DROP COLUMN "shiftCodes";
