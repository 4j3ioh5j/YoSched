-- Card #309 rollback. Rollback is CODE-ONLY: the old code ignores "criteria" and the triggers
-- accept its writes, so nothing here is needed to run 0.600.x. Use this only to remove the
-- card-309 guards. It keeps the "criteria" column and its data (rolling forward again uses it).
DROP TRIGGER IF EXISTS print_aggregate_columns_3_check_criteria_shift_ids ON "print_aggregate_columns";
DROP FUNCTION IF EXISTS print_criteria_check_shift_ids();
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
DROP FUNCTION IF EXISTS print_criteria_conditions(jsonb);
