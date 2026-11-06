-- Slice 2, Phase A of "settings follow the shift, not its code" (card #48): equity_factors gets shiftTypeId (FK, RESTRICT)
-- for factorType = 'shift' rows; built-in factors (desirability, holiday) keep both keys NULL. shiftCode stays until Phase B,
-- derived from the id by a TEMPORARY bridge (two triggers below) so a reverted (pre-slice) build still reads and writes
-- correct rows. A shift factor whose code matches no shift type aborts this migration: nothing is deleted.
ALTER TABLE "equity_factors" ADD COLUMN "shiftTypeId" TEXT;
UPDATE "equity_factors" ef SET "shiftTypeId" = st.id FROM "shift_types" st
  WHERE ef."factorType" = 'shift' AND st.code = ef."shiftCode";
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "equity_factors" WHERE "factorType" = 'shift' AND "shiftTypeId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'equity_factors: % shift factor(s) whose shiftCode matches no shift type; resolve them (delete or rename) before migrating', n;
  END IF;
END $$;
ALTER TABLE "equity_factors" ADD CONSTRAINT "equity_factors_shiftTypeId_fkey"
  FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "equity_factors_factorType_shiftTypeId_key" ON "equity_factors"("factorType", "shiftTypeId");

-- Bridge A: for shift factors both keys are always correct, whichever one the writer supplied; the id wins.
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
CREATE TRIGGER equity_factors_sync_keys BEFORE INSERT OR UPDATE ON "equity_factors"
  FOR EACH ROW EXECUTE FUNCTION equity_factors_sync_keys();

-- Bridge B: a shift code rename re-derives the retained code column.
CREATE OR REPLACE FUNCTION shift_types_sync_equity_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "equity_factors" SET "shiftCode" = NEW.code WHERE "shiftTypeId" = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER shift_types_sync_equity_code AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_equity_code();
