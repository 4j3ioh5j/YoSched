-- Rollback for migration 20261106040000_staffing_drop_shift_code (Phase B of the Staffing Rules id link).
-- Re-creates staffing_requirements."shiftCode" from each row's shift (by id), its unique index, and BOTH Phase A
-- bridge triggers, so that after this script either the Phase A build (5f41aa1, reads only the id) or even the
-- pre-A build (aa7df8e, reads/writes the code) runs correctly. Touches no other data. It also forgets the Phase B
-- migration in Prisma's history (`prisma migrate resolve --rolled-back` only accepts FAILED migrations, P3012),
-- so a later deploy of Phase B re-applies it. Re-runnable (every step is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- Usage on the VM: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261106040000_restore_staffing_shift_code.sql
BEGIN;

ALTER TABLE "staffing_requirements" ADD COLUMN IF NOT EXISTS "shiftCode" TEXT;
UPDATE "staffing_requirements" sr SET "shiftCode" = st.code FROM "shift_types" st WHERE st.id = sr."shiftTypeId";
CREATE UNIQUE INDEX IF NOT EXISTS "staffing_requirements_shiftCode_dayKey_key" ON "staffing_requirements"("shiftCode", "dayKey");

-- Bridge A (verbatim from 20261106030000): both keys always correct; the id wins.
CREATE OR REPLACE FUNCTION staffing_requirements_sync_keys() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."shiftTypeId" IS NULL AND NEW."shiftCode" IS NOT NULL THEN
    SELECT id INTO NEW."shiftTypeId" FROM "shift_types" WHERE code = NEW."shiftCode";
    IF NEW."shiftTypeId" IS NULL THEN
      RAISE EXCEPTION 'unknown shift code %', NEW."shiftCode";
    END IF;
  END IF;
  SELECT code INTO NEW."shiftCode" FROM "shift_types" WHERE id = NEW."shiftTypeId";
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staffing_requirements_sync_keys ON "staffing_requirements";
CREATE TRIGGER staffing_requirements_sync_keys BEFORE INSERT OR UPDATE ON "staffing_requirements"
  FOR EACH ROW EXECUTE FUNCTION staffing_requirements_sync_keys();

-- Bridge B (verbatim from 20261106030000): a shift code rename re-derives the code column.
CREATE OR REPLACE FUNCTION shift_types_sync_staffing_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "staffing_requirements" SET "shiftCode" = NEW.code WHERE "shiftTypeId" = NEW.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS shift_types_sync_staffing_code ON "shift_types";
CREATE TRIGGER shift_types_sync_staffing_code AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_staffing_code();

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106040000_staffing_drop_shift_code';

COMMIT;
