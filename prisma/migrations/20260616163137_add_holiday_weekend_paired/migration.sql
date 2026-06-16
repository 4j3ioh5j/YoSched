-- AlterTable: extend weekend pairing to absorb an adjacent holiday (3-day holiday weekend, same staff)
ALTER TABLE "shift_types" ADD COLUMN     "holidayWeekendPaired" BOOLEAN NOT NULL DEFAULT false;

-- Seed the default: the weekend CALL shift covers a leading/following holiday with the
-- same person (FRI-SAT-SUN or SAT-SUN-MON). Code-independent — no-op if CALL is absent
-- or has weekend pairing disabled in this deployment.
UPDATE "shift_types" SET "holidayWeekendPaired" = true
WHERE "code" = 'CALL' AND "weekendPaired" = true;
