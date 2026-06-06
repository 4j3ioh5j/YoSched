-- AlterTable: soft cap on how many providers may be off per day (0 = no cap).
ALTER TABLE "scheduling_preferences" ADD COLUMN "maxLeavePerDay" INTEGER NOT NULL DEFAULT 0;
