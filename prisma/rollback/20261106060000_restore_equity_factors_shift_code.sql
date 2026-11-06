-- Rollback for migration 20261106060000_equity_factors_drop_shift_code (Phase B of the Equity Factors id link).
-- Re-creates equity_factors."shiftCode" from each shift factor's shift (by id; built-in factors stay NULL), its unique
-- index, and BOTH Phase A bridge triggers, so that after this script either the Phase A build (83c298b, reads only the
-- id) or even the pre-A build (5c4d167, reads/writes the code) runs correctly. Touches no other data. It also forgets
-- the Phase B migration in Prisma's history (`prisma migrate resolve --rolled-back` only accepts FAILED migrations,
-- P3012), so a later deploy of Phase B re-applies it. Re-runnable (every step is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- Usage on the VM: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261106060000_restore_equity_factors_shift_code.sql
BEGIN;

ALTER TABLE "equity_factors" ADD COLUMN IF NOT EXISTS "shiftCode" TEXT;
UPDATE "equity_factors" ef SET "shiftCode" = st.code FROM "shift_types" st
  WHERE ef."factorType" = 'shift' AND st.id = ef."shiftTypeId";
CREATE UNIQUE INDEX IF NOT EXISTS "equity_factors_factorType_shiftCode_key" ON "equity_factors"("factorType", "shiftCode");

-- Bridge A (verbatim from 20261106050000): for shift factors both keys are always correct; the id wins.
-- Built-in factors are left alone (both NULL).
CREATE OR REPLACE FUNCTION equity_factors_sync_keys() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."factorType" <> 'shift' THEN
    RETURN NEW;
  END IF;
  IF NEW."shiftTypeId" IS NULL AND NEW."shiftCode" IS NOT NULL THEN
    SELECT id INTO NEW."shiftTypeId" FROM "shift_types" WHERE code = NEW."shiftCode";
    IF NEW."shiftTypeId" IS NULL THEN
      RAISE EXCEPTION 'unknown shift code %', NEW."shiftCode";
    END IF;
  END IF;
  IF NEW."shiftTypeId" IS NOT NULL THEN
    SELECT code INTO NEW."shiftCode" FROM "shift_types" WHERE id = NEW."shiftTypeId";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS equity_factors_sync_keys ON "equity_factors";
CREATE TRIGGER equity_factors_sync_keys BEFORE INSERT OR UPDATE ON "equity_factors"
  FOR EACH ROW EXECUTE FUNCTION equity_factors_sync_keys();

-- Bridge B (verbatim from 20261106050000): a shift code rename re-derives the retained code column.
CREATE OR REPLACE FUNCTION shift_types_sync_equity_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "equity_factors" SET "shiftCode" = NEW.code WHERE "shiftTypeId" = NEW.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS shift_types_sync_equity_code ON "shift_types";
CREATE TRIGGER shift_types_sync_equity_code AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_equity_code();

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106060000_equity_factors_drop_shift_code';

COMMIT;
