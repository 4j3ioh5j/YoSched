-- Card #72: drop two staff columns no code reads (verified empty on live 2026-11-06: 0 non-NULL rows).
-- Rollback (re-runnable), run BEFORE redeploying older code (its Prisma client selects these columns):
--   prisma/rollback/20261107020000_restore_unused_staff_columns.sql
ALTER TABLE "staff" DROP COLUMN IF EXISTS "fteSplit", DROP COLUMN IF EXISTS "feeBasisHoursPerShift";
