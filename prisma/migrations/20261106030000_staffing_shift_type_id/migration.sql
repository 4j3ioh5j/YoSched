-- Phase A of "Staffing Rules follow the shift, not its code" (card #48): staffing_requirements gets shiftTypeId (FK, RESTRICT).
-- shiftCode stays until Phase B, derived from the id by a TEMPORARY bridge (two triggers below) so a reverted (pre-A) build
-- still reads and writes correct rows. An orphan row (code matching no shift type) aborts this migration: nothing is deleted.
ALTER TABLE "staffing_requirements" ADD COLUMN "shiftTypeId" TEXT;
UPDATE "staffing_requirements" sr SET "shiftTypeId" = st.id FROM "shift_types" st WHERE st.code = sr."shiftCode";
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "staffing_requirements" WHERE "shiftTypeId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'staffing_requirements: % row(s) whose shiftCode matches no shift type; resolve them (delete or rename) before migrating', n;
  END IF;
END $$;
ALTER TABLE "staffing_requirements" ALTER COLUMN "shiftTypeId" SET NOT NULL;
ALTER TABLE "staffing_requirements" ADD CONSTRAINT "staffing_requirements_shiftTypeId_fkey"
  FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "staffing_requirements_shiftTypeId_dayKey_key" ON "staffing_requirements"("shiftTypeId", "dayKey");
ALTER TABLE "staffing_requirements" ALTER COLUMN "shiftCode" DROP NOT NULL;

-- Bridge A: both keys always correct, whichever one the writer supplied; the id wins.
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
CREATE TRIGGER staffing_requirements_sync_keys BEFORE INSERT OR UPDATE ON "staffing_requirements"
  FOR EACH ROW EXECUTE FUNCTION staffing_requirements_sync_keys();

-- Bridge B: a shift code rename re-derives the retained code column.
CREATE OR REPLACE FUNCTION shift_types_sync_staffing_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "staffing_requirements" SET "shiftCode" = NEW.code WHERE "shiftTypeId" = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER shift_types_sync_staffing_code AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_staffing_code();
