-- Phase B of "Equity Factors follow the shift, not its code" (card #48). Phase A (20261106050000) linked
-- equity_factors to shift_types.id and kept "shiftCode" only as a trigger-derived compat column for a pre-A build.
-- Phase A is deployed and verified; nothing reads or writes the column any more (every reader derives the shift's
-- current code from shift_types in code via deriveEquityFactorCodes, not from this column). Drop the bridge and the column.
-- Rollback (non-destructive, re-runnable): prisma/rollback/20261106060000_restore_equity_factors_shift_code.sql
DROP TRIGGER IF EXISTS equity_factors_sync_keys ON "equity_factors";
DROP FUNCTION IF EXISTS equity_factors_sync_keys();
DROP TRIGGER IF EXISTS shift_types_sync_equity_code ON "shift_types";
DROP FUNCTION IF EXISTS shift_types_sync_equity_code();
DROP INDEX IF EXISTS "equity_factors_factorType_shiftCode_key";
ALTER TABLE "equity_factors" DROP COLUMN "shiftCode";
