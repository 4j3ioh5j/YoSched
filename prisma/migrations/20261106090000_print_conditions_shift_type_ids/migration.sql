-- Slice 4, Phase A of "settings follow the shift, not its code" (card #48): the shift conditions of print_column_rules and
-- print_aggregate_columns (jsonb "conditions": [{quantifier, categories, codes, except}]) gain "shiftTypeIds" / "exceptIds"
-- (shift_types.id, in order). The old keys "codes" / "except" stay until Phase B, derived from the ids by a TEMPORARY bridge
-- (triggers *_1_sync_conditions + shift_types_sync_print_codes) so a reverted (pre-slice) build still reads and writes
-- correct rows. print_column_rules' legacy single selector ("shiftCodes" / "shiftMatch") is folded into "conditions" first,
-- exactly as the application did at read time (conditions win when non-empty); the two columns stay until Phase B.
-- A condition naming a code that matches no shift type aborts this migration: nothing is changed.
-- Json cannot carry a foreign key, so PERMANENT triggers stand in for ON DELETE RESTRICT (*_2_check_shift_ids = every stored
-- id must exist, locking the shifts FOR KEY SHARE like a FK would; shift_types_block_delete_print_column = a shift named by a
-- rule or column cannot be deleted).

-- 1. Fold the legacy selector (rows predating "conditions"; the app used it only while "conditions" was empty).
UPDATE "print_column_rules"
   SET conditions = jsonb_build_array(jsonb_build_object(
         'quantifier', CASE WHEN "shiftMatch" = 'all' THEN 'has_all' ELSE 'has_any' END,
         'categories', '[]'::jsonb,
         'codes', to_jsonb("shiftCodes"),
         'except', '[]'::jsonb))
 WHERE jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) = 0 AND cardinality("shiftCodes") > 0;

-- 2. Helpers (PERMANENT; pure).
-- The string elements of a jsonb array, in order (anything that is not an array or not a string is ignored — the same
-- leniency as the application's coerceConditions).
CREATE OR REPLACE FUNCTION print_strings(arr jsonb) RETURNS TABLE(val text, ord bigint) LANGUAGE sql IMMUTABLE AS $$
  SELECT e #>> '{}', t.ord
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(arr) = 'array' THEN arr ELSE '[]'::jsonb END) WITH ORDINALITY t(e, ord)
   WHERE jsonb_typeof(e) = 'string'
$$;
-- Codes → ids in order; a code that matches no shift raises.
CREATE OR REPLACE FUNCTION print_ids_from_codes(codes jsonb, label text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE ids jsonb; n integer; want integer;
BEGIN
  SELECT COALESCE(jsonb_agg(st.id ORDER BY s.ord), '[]'::jsonb), count(*) INTO ids, n
    FROM print_strings(codes) s JOIN "shift_types" st ON st.code = s.val;
  SELECT count(*) INTO want FROM print_strings(codes);
  IF n <> want THEN
    RAISE EXCEPTION 'printed-schedule column "%": unknown shift code in %', label, codes;
  END IF;
  RETURN ids;
END $$;
-- Ids → current codes in order (an id that matches no shift is dropped, never invented).
CREATE OR REPLACE FUNCTION print_codes_from_ids(ids jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(st.code ORDER BY s.ord), '[]'::jsonb) FROM print_strings(ids) s JOIN "shift_types" st ON st.id = s.val
$$;
-- One condition list made consistent: ids filled from codes when absent (an old-build write), then codes re-derived from
-- the ids (the id wins). Non-object elements pass through untouched.
CREATE OR REPLACE FUNCTION print_conditions_sync(conds jsonb, label text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb := '[]'::jsonb; c jsonb; ids jsonb; exc jsonb;
BEGIN
  IF conds IS NULL OR jsonb_typeof(conds) <> 'array' THEN
    RETURN conds;
  END IF;
  FOR c IN SELECT e FROM jsonb_array_elements(conds) e LOOP
    IF jsonb_typeof(c) <> 'object' THEN
      result := result || jsonb_build_array(c);
      CONTINUE;
    END IF;
    ids := CASE WHEN jsonb_typeof(c->'shiftTypeIds') = 'array' THEN c->'shiftTypeIds' ELSE '[]'::jsonb END;
    exc := CASE WHEN jsonb_typeof(c->'exceptIds') = 'array' THEN c->'exceptIds' ELSE '[]'::jsonb END;
    IF jsonb_array_length(ids) = 0 THEN ids := print_ids_from_codes(c->'codes', label); END IF;
    IF jsonb_array_length(exc) = 0 THEN exc := print_ids_from_codes(c->'except', label); END IF;
    result := result || jsonb_build_array(c || jsonb_build_object(
      'shiftTypeIds', ids, 'exceptIds', exc,
      'codes', print_codes_from_ids(ids), 'except', print_codes_from_ids(exc)));
  END LOOP;
  RETURN result;
END $$;
-- Does a condition list name this shift id (in shiftTypeIds or exceptIds)?
CREATE OR REPLACE FUNCTION print_conditions_reference(conds jsonb, sid text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT conds @> jsonb_build_array(jsonb_build_object('shiftTypeIds', jsonb_build_array(sid)))
      OR conds @> jsonb_build_array(jsonb_build_object('exceptIds', jsonb_build_array(sid)))
$$;

-- 3. Orphan guard: every code named by any condition in either table must be a current shift code.
DO $$
DECLARE r record; n integer := 0; msg text := '';
BEGIN
  FOR r IN
    SELECT t.tbl, t.label, s.val AS code
      FROM (SELECT 'print_column_rules' AS tbl, label, conditions FROM "print_column_rules"
            UNION ALL
            SELECT 'print_aggregate_columns', label, conditions FROM "print_aggregate_columns") t,
           LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.conditions) = 'array' THEN t.conditions ELSE '[]'::jsonb END) c,
           LATERAL (SELECT val FROM print_strings(c->'codes') UNION ALL SELECT val FROM print_strings(c->'except')) s
     WHERE NOT EXISTS (SELECT 1 FROM "shift_types" st WHERE st.code = s.val)
  LOOP
    n := n + 1; msg := msg || format(' [%s "%s": %s]', r.tbl, r.label, r.code);
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'printed-schedule columns: % shift code(s) match no shift type:%; remove them in Settings before migrating', n, msg;
  END IF;
END $$;

-- 4. Rewrite every condition (ids added beside the codes).
UPDATE "print_column_rules" SET conditions = print_conditions_sync(conditions, label);
UPDATE "print_aggregate_columns" SET conditions = print_conditions_sync(conditions, label);

-- 5. Bridge triggers (TEMPORARY, dropped in Phase B). Run first: BEFORE triggers fire in name order ("…_1_" < "…_2_").
CREATE OR REPLACE FUNCTION print_conditions_sync_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.conditions := print_conditions_sync(NEW.conditions, NEW.label);
  RETURN NEW;
END $$;
CREATE TRIGGER print_column_rules_1_sync_conditions BEFORE INSERT OR UPDATE ON "print_column_rules"
  FOR EACH ROW EXECUTE FUNCTION print_conditions_sync_trigger();
CREATE TRIGGER print_aggregate_columns_1_sync_conditions BEFORE INSERT OR UPDATE ON "print_aggregate_columns"
  FOR EACH ROW EXECUTE FUNCTION print_conditions_sync_trigger();
-- A shift code rename re-derives the retained code keys of every condition naming the shift (trigger 1 does the work).
CREATE OR REPLACE FUNCTION shift_types_sync_print_codes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "print_column_rules" SET conditions = conditions WHERE print_conditions_reference(conditions, NEW.id);
  UPDATE "print_aggregate_columns" SET conditions = conditions WHERE print_conditions_reference(conditions, NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER shift_types_sync_print_codes AFTER UPDATE OF code ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_sync_print_codes();

-- 6. Validator (PERMANENT): every id named by a condition must be a current shift. The shifts are locked FOR KEY SHARE for
-- the rest of the writing transaction, as a foreign key does, so a concurrent delete of one waits and then sees this row.
CREATE OR REPLACE FUNCTION print_conditions_check_shift_ids() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[]; n integer;
BEGIN
  IF NEW.conditions IS NULL OR jsonb_typeof(NEW.conditions) <> 'array' THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(DISTINCT s.val) INTO ids
    FROM jsonb_array_elements(NEW.conditions) c,
         LATERAL (SELECT val FROM print_strings(c->'shiftTypeIds') UNION ALL SELECT val FROM print_strings(c->'exceptIds')) s;
  IF ids IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM id FROM "shift_types" WHERE id = ANY(ids) FOR KEY SHARE;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(ids) THEN
    RAISE EXCEPTION 'printed-schedule column "%": unknown shift id in its conditions', NEW.label;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER print_column_rules_2_check_shift_ids BEFORE INSERT OR UPDATE ON "print_column_rules"
  FOR EACH ROW EXECUTE FUNCTION print_conditions_check_shift_ids();
CREATE TRIGGER print_aggregate_columns_2_check_shift_ids BEFORE INSERT OR UPDATE ON "print_aggregate_columns"
  FOR EACH ROW EXECUTE FUNCTION print_conditions_check_shift_ids();

-- 7. Delete guard (PERMANENT): a shift still named by a rule or column cannot be deleted (the route refuses first with a
-- friendly message; this is the backstop for every other path). The row lock waits for any in-flight save holding KEY SHARE
-- on this shift; the check then runs on a fresh snapshot and sees that save.
CREATE OR REPLACE FUNCTION shift_types_block_delete_print_column() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE used text;
BEGIN
  PERFORM 1 FROM "shift_types" WHERE id = OLD.id FOR UPDATE;
  SELECT string_agg(label, ', ' ORDER BY label) INTO used
    FROM (SELECT label FROM "print_column_rules" WHERE print_conditions_reference(conditions, OLD.id)
          UNION ALL
          SELECT label FROM "print_aggregate_columns" WHERE print_conditions_reference(conditions, OLD.id)) t;
  IF used IS NOT NULL THEN
    RAISE EXCEPTION 'shift % is used by printed-schedule column rule(s): %', OLD.code, used;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER shift_types_block_delete_print_column BEFORE DELETE ON "shift_types"
  FOR EACH ROW EXECUTE FUNCTION shift_types_block_delete_print_column();
