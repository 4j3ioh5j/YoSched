-- Rollback for migration 20261106080000_count_columns_drop_shift_codes (Phase B of the Count Columns id link).
-- Re-creates count_columns."shiftCodes" from each column's shifts (by id, in order) and BOTH Phase A bridge triggers, so that
-- after this script either the Phase A build (a4f472a, reads only the ids) or even the pre-A build (6d84f00, reads/writes the
-- codes) runs correctly. Run it BEFORE redeploying the Phase A build: its generated client selects "shiftCodes" in full-row
-- queries. Touches no other data; the two PERMANENT triggers (count_columns_2_check_shift_ids,
-- shift_types_block_delete_count_column) are left as they are. It also forgets the Phase B migration in Prisma's history
-- (`prisma migrate resolve --rolled-back` only accepts FAILED migrations, P3012), so a later deploy of Phase B re-applies it.
-- Re-runnable (every step is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- Usage on the VM: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261106080000_restore_count_columns_shift_codes.sql
BEGIN;

ALTER TABLE "count_columns" ADD COLUMN IF NOT EXISTS "shiftCodes" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "count_columns" cc SET "shiftCodes" = COALESCE(
  (SELECT array_agg(st.code ORDER BY u.ord)
     FROM unnest(cc."shiftTypeIds") WITH ORDINALITY u(id, ord)
     JOIN "shift_types" st ON st.id = u.id),
  '{}');

-- Trigger 1 (verbatim from 20261106070000): an old-build createMany supplies codes only → resolve them to ids in order
-- (unknown code raises); whenever ids are present the code array is re-derived from them (the id wins). Runs before the
-- permanent validator ("count_columns_1_…" < "count_columns_2_…").
CREATE OR REPLACE FUNCTION count_columns_sync_keys() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[]; codes text[];
BEGIN
  NEW."shiftTypeIds" := COALESCE(NEW."shiftTypeIds", '{}');
  NEW."shiftCodes" := COALESCE(NEW."shiftCodes", '{}');
  IF cardinality(NEW."shiftTypeIds") = 0 AND cardinality(NEW."shiftCodes") > 0 THEN
    SELECT array_agg(st.id ORDER BY u.ord) INTO ids
      FROM unnest(NEW."shiftCodes") WITH ORDINALITY u(code, ord)
      JOIN "shift_types" st ON st.code = u.code;
    IF COALESCE(cardinality(ids), 0) <> cardinality(NEW."shiftCodes") THEN
      RAISE EXCEPTION 'count_columns "%": unknown shift code in %', NEW.label, NEW."shiftCodes";
    END IF;
    NEW."shiftTypeIds" := ids;
  END IF;
  IF cardinality(NEW."shiftTypeIds") > 0 THEN
    SELECT array_agg(st.code ORDER BY u.ord) INTO codes
      FROM unnest(NEW."shiftTypeIds") WITH ORDINALITY u(id, ord)
      JOIN "shift_types" st ON st.id = u.id;
    NEW."shiftCodes" := COALESCE(codes, '{}');
  ELSE
    NEW."shiftCodes" := '{}';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS count_columns_1_sync_keys ON "count_columns";
CREATE TRIGGER count_columns_1_sync_keys BEFORE INSERT OR UPDATE ON "count_columns"
  FOR EACH ROW EXECUTE FUNCTION count_columns_sync_keys();

-- Trigger 4 (verbatim from 20261106070000): a shift code rename re-derives the retained code arrays.
CREATE OR REPLACE FUNCTION shift_types_sync_count_codes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "count_columns" SET "shiftTypeIds" = "shiftTypeIds" WHERE "shiftTypeIds" @> ARRAY[NEW.id];
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS shift_types_sync_count_codes ON "shift_types";
CREATE TRIGGER shift_types_sync_count_codes AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_count_codes();

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106080000_count_columns_drop_shift_codes';

COMMIT;
