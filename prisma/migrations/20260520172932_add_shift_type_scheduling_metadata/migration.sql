-- AlterTable
ALTER TABLE "shift_types" ADD COLUMN     "eligibilityRule" TEXT,
ADD COLUMN     "ignoresWorkingDays" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFillShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOffShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schedulePriority" INTEGER,
ADD COLUMN     "weekendPaired" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "countsOnWeekend" SET DEFAULT false;
