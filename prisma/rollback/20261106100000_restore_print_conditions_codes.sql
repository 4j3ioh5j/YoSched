-- Rollback for migration 20261106100000_print_conditions_drop_codes (Phase B of the printed-schedule columns id link).
-- Re-creates print_column_rules."shiftCodes" / "shiftMatch" (empty / 'any': the Phase A migration folded every legacy selector
-- into "conditions", which both earlier builds prefer when non-empty), re-derives the "codes" / "except" keys of every
-- condition from its ids with the PERMANENT helper print_conditions_sync, and re-creates the three Phase A bridge triggers,
-- so that after this script either the Phase A build (0fda624, reads only the ids) or even the pre-A build (ea7e192,
-- reads/writes the codes) runs correctly. Run it BEFORE redeploying the Phase A build: its generated client selects
-- "shiftCodes" and "shiftMatch" in full-row queries. Touches no other data; the PERMANENT triggers
-- (print_column_rules_2_check_shift_ids, print_aggregate_columns_2_check_shift_ids, shift_types_block_delete_print_column)
-- and the print_* helpers are left as they are. It also forgets the Phase B migration in Prisma's history
-- (`prisma migrate resolve --rolled-back` only accepts FAILED migrations, P3012), so a later deploy of Phase B re-applies it.
-- Re-runnable (every step is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS; the UPDATEs are idempotent).
-- Usage on the VM: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261106100000_restore_print_conditions_codes.sql
BEGIN;

ALTER TABLE "print_column_rules" ADD COLUMN IF NOT EXISTS "shiftCodes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "print_column_rules" ADD COLUMN IF NOT EXISTS "shiftMatch" TEXT NOT NULL DEFAULT 'any';

UPDATE "print_column_rules" SET conditions = print_conditions_sync(conditions, label);
UPDATE "print_aggregate_columns" SET conditions = print_conditions_sync(conditions, label);

-- Bridge (verbatim from 20261106090000). Runs before the permanent validator ("…_1_" < "…_2_").
CREATE OR REPLACE FUNCTION print_conditions_sync_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.conditions := print_conditions_sync(NEW.conditions, NEW.label);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS print_column_rules_1_sync_conditions ON "print_column_rules";
CREATE TRIGGER print_column_rules_1_sync_conditions BEFORE INSERT OR UPDATE ON "print_column_rules"
  FOR EACH ROW EXECUTE FUNCTION print_conditions_sync_trigger();
DROP TRIGGER IF EXISTS print_aggregate_columns_1_sync_conditions ON "print_aggregate_columns";
CREATE TRIGGER print_aggregate_columns_1_sync_conditions BEFORE INSERT OR UPDATE ON "print_aggregate_columns"
  FOR EACH ROW EXECUTE FUNCTION print_conditions_sync_trigger();
-- A shift code rename re-derives the retained code keys of every condition naming the shift (trigger 1 does the work).
CREATE OR REPLACE FUNCTION shift_types_sync_print_codes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "print_column_rules" SET conditions = conditions WHERE print_conditions_reference(conditions, NEW.id);
  UPDATE "print_aggregate_columns" SET conditions = conditions WHERE print_conditions_reference(conditions, NEW.id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS shift_types_sync_print_codes ON "shift_types";
CREATE TRIGGER shift_types_sync_print_codes AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_print_codes();

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106100000_print_conditions_drop_codes';

COMMIT;
