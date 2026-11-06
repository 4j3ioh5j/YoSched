-- Card #75 rollback is CODE-ONLY: the three activation* columns are additive with defaults and the
-- old code never reads them. Leave them in place (dropping would lose David's chosen defaults if
-- the release is re-deployed). Nothing to run.
SELECT 1;
