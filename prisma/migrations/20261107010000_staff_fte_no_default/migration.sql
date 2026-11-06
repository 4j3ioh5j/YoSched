-- Card #71 Phase B: a staff row inserted without an FTE % no longer silently gets 100%.
-- Schema only — no stored value changes (NULL keeps meaning "inherit the type default").
-- Rollback (re-runnable): prisma/rollback/20261107010000_staff_fte_default_restore.sql
ALTER TABLE "staff" ALTER COLUMN "ftePercentage" DROP DEFAULT;
