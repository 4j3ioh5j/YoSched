-- Card #467: two new auto-generation priority factors at the bottom of the order, "Long weekends
-- off" just above "Even OR staffing across days". Appended after the install's current lowest row,
-- so an admin's custom order is kept. Idempotent (a re-run or a row already present is a no-op).
-- Rollback: code-only. Engines from 0.640.0 / 0.640.1 ignore these rows and keep the configured order.
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness")
SELECT 'agf_long_weekends', 'longWeekends', 'Long weekends off', COALESCE(MAX("sortOrder"), -1) + 1, true, 'soft'
  FROM "autogen_factors"
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness")
SELECT 'agf_day_balance', 'dayBalance', 'Even OR staffing across days', COALESCE(MAX("sortOrder"), -1) + 1, true, 'soft'
  FROM "autogen_factors"
ON CONFLICT ("key") DO NOTHING;
