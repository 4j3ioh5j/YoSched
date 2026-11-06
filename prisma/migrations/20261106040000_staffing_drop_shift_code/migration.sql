-- Phase B of "Staffing Rules follow the shift, not its code" (card #48). Phase A (20261106030000) linked
-- staffing_requirements to shift_types.id and kept "shiftCode" only as a trigger-derived compat column for a
-- pre-A build. Phase A is deployed and verified; nothing reads or writes the column any more (the engine input
-- bundle's wire `shiftCode` is derived from shift_types in code, not from this column). Drop the bridge and the column.
-- Rollback (non-destructive, re-runnable): prisma/rollback/20261106040000_restore_staffing_shift_code.sql
DROP TRIGGER IF EXISTS staffing_requirements_sync_keys ON "staffing_requirements";
DROP FUNCTION IF EXISTS staffing_requirements_sync_keys();
DROP TRIGGER IF EXISTS shift_types_sync_staffing_code ON "shift_types";
DROP FUNCTION IF EXISTS shift_types_sync_staffing_code();
DROP INDEX IF EXISTS "staffing_requirements_shiftCode_dayKey_key";
ALTER TABLE "staffing_requirements" DROP COLUMN "shiftCode";
