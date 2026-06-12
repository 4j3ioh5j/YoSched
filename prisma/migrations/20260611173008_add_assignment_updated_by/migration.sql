-- Track the acting user on each assignment write (for conflict attribution).
-- Additive, nullable, no backfill; NOT a foreign key so user deletion is never blocked.
ALTER TABLE "assignments" ADD COLUMN "updatedBy" TEXT;
