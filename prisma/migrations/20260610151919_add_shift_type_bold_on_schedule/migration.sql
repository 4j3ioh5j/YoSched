-- Add ShiftType.boldOnSchedule: render this shift's code in bold on the printed schedule.
--
-- The column defaults to false. Existing rows are created before this flag existed, and
-- deploys run `prisma migrate deploy` (not `db seed`), so seed defaults never reach the
-- live DB without an explicit backfill (the #122/#139 seed-vs-migrate drift). To avoid a
-- manual staging SQL step, this migration sets the flag true for the three call/late
-- shifts the user asked to bold by default (CALL, ORC, ORL). New shifts default to false
-- and admins toggle the flag per shift in Settings.

ALTER TABLE "shift_types" ADD COLUMN "boldOnSchedule" BOOLEAN NOT NULL DEFAULT false;

UPDATE "shift_types" SET "boldOnSchedule" = true WHERE "code" IN ('CALL', 'ORC', 'ORL');
