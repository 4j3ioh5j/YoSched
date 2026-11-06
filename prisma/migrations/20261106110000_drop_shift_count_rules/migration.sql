-- Drop the dead shift_count_rules table (card #62). It was created by 20260520025235 as a per-day exact-count rule
-- keyed by shift code, written only by prisma/seed.ts and read by nothing: Staffing Rules (staffing_requirements,
-- per shift ID and day, min/preferred/max) replaced it. The six seed rows it held are reproduced by the rollback.
-- Rollback (re-runnable): prisma/rollback/20261106110000_restore_shift_count_rules.sql
DROP TABLE IF EXISTS "shift_count_rules";
