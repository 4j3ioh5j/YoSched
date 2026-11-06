-- Slice 3, Phase A of "settings follow the shift, not its code" (card #48): count_columns gets "shiftTypeIds" (ordered array of
-- shift_types.id). "shiftCodes" stays until Phase B, derived from the ids by a TEMPORARY bridge (trigger 1 below) so a
-- reverted (pre-slice) build still reads and writes correct rows. A count column naming a code that matches no shift type
-- aborts this migration: nothing is changed or deleted.
-- An array cannot carry a foreign key, so two PERMANENT triggers stand in for ON DELETE RESTRICT (trigger 2 = every stored id
-- must exist, locking the shifts FOR KEY SHARE like a FK would; trigger 3 = a shift used by a count column cannot be deleted).
ALTER TABLE "count_columns" ADD COLUMN "shiftTypeIds" TEXT[] NOT NULL DEFAULT '{}';

DO $$
DECLARE r record; n integer := 0; msg text := '';
BEGIN
  FOR r IN
    SELECT cc.label, u.code FROM "count_columns" cc, unnest(cc."shiftCodes") u(code)
    WHERE NOT EXISTS (SELECT 1 FROM "shift_types" st WHERE st.code = u.code)
  LOOP
    n := n + 1; msg := msg || format(' [%s: %s]', r.label, r.code);
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'count_columns: % shift code(s) match no shift type:%; remove them in Settings before migrating', n, msg;
  END IF;
END $$;

UPDATE "count_columns" cc SET "shiftTypeIds" = COALESCE(
  (SELECT array_agg(st.id ORDER BY u.ord)
     FROM unnest(cc."shiftCodes") WITH ORDINALITY u(code, ord)
     JOIN "shift_types" st ON st.code = u.code),
  '{}');

-- Trigger 1 (TEMPORARY bridge, dropped in Phase B): an old-build createMany supplies codes only → resolve them to ids in order
-- (unknown code raises); whenever ids are present the code array is re-derived from them (the id wins). Runs first: BEFORE
-- triggers fire in name order and "count_columns_1_…" < "count_columns_2_…".
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
CREATE TRIGGER count_columns_1_sync_keys BEFORE INSERT OR UPDATE ON "count_columns"
  FOR EACH ROW EXECUTE FUNCTION count_columns_sync_keys();

-- Trigger 2 (PERMANENT): every stored id must be a current shift. The shifts are locked FOR KEY SHARE for the rest of the
-- writing transaction, exactly as a foreign key does, so a concurrent delete of one of them waits and then sees this row.
CREATE OR REPLACE FUNCTION count_columns_check_shift_ids() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; want integer;
BEGIN
  NEW."shiftTypeIds" := COALESCE(NEW."shiftTypeIds", '{}');
  IF cardinality(NEW."shiftTypeIds") = 0 THEN
    RETURN NEW;
  END IF;
  PERFORM id FROM "shift_types" WHERE id = ANY(NEW."shiftTypeIds") FOR KEY SHARE;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(DISTINCT x) INTO want FROM unnest(NEW."shiftTypeIds") x;
  IF n <> want THEN
    RAISE EXCEPTION 'count_columns "%": unknown shift id in %', NEW.label, NEW."shiftTypeIds";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER count_columns_2_check_shift_ids BEFORE INSERT OR UPDATE ON "count_columns"
  FOR EACH ROW EXECUTE FUNCTION count_columns_check_shift_ids();

-- Trigger 3 (PERMANENT): a shift still named by a count column cannot be deleted (the route refuses first with a friendly
-- message; this is the backstop for every other path). The row lock waits for any in-flight save that holds KEY SHARE on
-- this shift; the check then runs on a fresh snapshot and sees that save.
CREATE OR REPLACE FUNCTION shift_types_block_delete_count_column() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE used text;
BEGIN
  PERFORM 1 FROM "shift_types" WHERE id = OLD.id FOR UPDATE;
  SELECT string_agg(label, ', ' ORDER BY "sortOrder") INTO used FROM "count_columns" WHERE "shiftTypeIds" @> ARRAY[OLD.id];
  IF used IS NOT NULL THEN
    RAISE EXCEPTION 'shift % is used by count column(s): %', OLD.code, used;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER shift_types_block_delete_count_column BEFORE DELETE ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_block_delete_count_column();

-- Trigger 4 (TEMPORARY bridge, dropped in Phase B): a shift code rename re-derives the retained code arrays (trigger 1 does
-- the work; this just touches the rows that name the shift).
CREATE OR REPLACE FUNCTION shift_types_sync_count_codes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "count_columns" SET "shiftTypeIds" = "shiftTypeIds" WHERE "shiftTypeIds" @> ARRAY[NEW.id];
  RETURN NULL;
END $$;
CREATE TRIGGER shift_types_sync_count_codes AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_count_codes();
