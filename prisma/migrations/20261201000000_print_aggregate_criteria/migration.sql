-- Card #309: printed aggregate columns get several Include / Exclude rule lines. Additive and
-- nullable: NULL = a row from before the lines (its single rule is the one Include line), so no
-- row is rewritten and rollback is code-only (the old code ignores the column; these triggers
-- accept its writes). See prisma/rollback/20261201000000_print_aggregate_criteria.sql.
ALTER TABLE "print_aggregate_columns" ADD COLUMN "criteria" JSONB;
-- The old single-rule fields as they were when "criteria" was written. If they differ on read, a
-- server from before the lines (a rollback) edited the column since, and that edit wins.
ALTER TABLE "print_aggregate_columns" ADD COLUMN "criteriaBase" JSONB;

-- Every condition of every line, as one conditions array (for the shift-id checks below).
CREATE OR REPLACE FUNCTION print_criteria_conditions(criteria jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(criteria) = 'array' THEN criteria ELSE '[]'::jsonb END) l,
         jsonb_array_elements(CASE WHEN jsonb_typeof(l->'conditions') = 'array' THEN l->'conditions' ELSE '[]'::jsonb END) c
$$;

-- Validator: every shift id named in a line must be a current shift, locked FOR KEY SHARE for the
-- rest of the writing transaction (as print_conditions_check_shift_ids does for "conditions").
CREATE OR REPLACE FUNCTION print_criteria_check_shift_ids() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[]; n integer;
BEGIN
  SELECT array_agg(DISTINCT s.val) INTO ids
    FROM jsonb_array_elements(print_criteria_conditions(NEW.criteria)) c,
         LATERAL (SELECT val FROM print_strings(c->'shiftTypeIds') UNION ALL SELECT val FROM print_strings(c->'exceptIds')) s;
  IF ids IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM id FROM "shift_types" WHERE id = ANY(ids) FOR KEY SHARE;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> cardinality(ids) THEN
    RAISE EXCEPTION 'printed-schedule column "%": unknown shift id in its rules', NEW.label;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER print_aggregate_columns_3_check_criteria_shift_ids BEFORE INSERT OR UPDATE ON "print_aggregate_columns"
  FOR EACH ROW EXECUTE FUNCTION print_criteria_check_shift_ids();

-- Delete guard: a shift named by a line also blocks the delete.
CREATE OR REPLACE FUNCTION shift_types_block_delete_print_column() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE used text;
BEGIN
  PERFORM 1 FROM "shift_types" WHERE id = OLD.id FOR UPDATE;
  SELECT string_agg(label, ', ' ORDER BY label) INTO used
    FROM (SELECT label FROM "print_column_rules" WHERE print_conditions_reference(conditions, OLD.id)
          UNION ALL
          SELECT label FROM "print_aggregate_columns"
           WHERE print_conditions_reference(conditions, OLD.id)
              OR print_conditions_reference(print_criteria_conditions(criteria), OLD.id)) t;
  IF used IS NOT NULL THEN
    RAISE EXCEPTION 'shift % is used by printed-schedule column rule(s): %', OLD.code, used;
  END IF;
  RETURN OLD;
END $$;
