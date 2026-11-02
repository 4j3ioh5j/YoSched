-- AlterTable
ALTER TABLE "scheduling_preferences" ADD COLUMN     "deviceTrustDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "shift_types" ADD COLUMN     "autoSchedulable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "staff" RENAME CONSTRAINT "providers_pkey" TO "staff_pkey";

-- AlterTable
ALTER TABLE "staff_day_preferences" RENAME CONSTRAINT "provider_day_preferences_pkey" TO "staff_day_preferences_pkey";

-- AlterTable
ALTER TABLE "staff_eligible_shifts" RENAME CONSTRAINT "provider_eligible_shifts_pkey" TO "staff_eligible_shifts_pkey";

-- AlterTable
ALTER TABLE "staff_shift_overrides" RENAME CONSTRAINT "provider_shift_overrides_pkey" TO "staff_shift_overrides_pkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "login_logs" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_follow_rules" (
    "id" TEXT NOT NULL,
    "sourceShiftId" TEXT NOT NULL,
    "allowedShiftId" TEXT,
    "allowOffShifts" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'allow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_follow_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_logs_email_idx" ON "login_logs"("email");

-- CreateIndex
CREATE INDEX "login_logs_createdAt_idx" ON "login_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shift_follow_rules_sourceShiftId_allowedShiftId_key" ON "shift_follow_rules"("sourceShiftId", "allowedShiftId");

-- RenameForeignKey
ALTER TABLE "assignments" RENAME CONSTRAINT "assignments_providerId_fkey" TO "assignments_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "availability_rules" RENAME CONSTRAINT "availability_rules_conditionProviderId_fkey" TO "availability_rules_conditionStaffId_fkey";

-- RenameForeignKey
ALTER TABLE "availability_rules" RENAME CONSTRAINT "availability_rules_providerId_fkey" TO "availability_rules_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "schedule_requests" RENAME CONSTRAINT "schedule_requests_providerId_fkey" TO "schedule_requests_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "shift_eligibility_rules" RENAME CONSTRAINT "shift_eligibility_rules_providerId_fkey" TO "shift_eligibility_rules_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "shift_minimum_targets" RENAME CONSTRAINT "shift_minimum_targets_providerId_fkey" TO "shift_minimum_targets_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "staff" RENAME CONSTRAINT "providers_employmentTypeId_fkey" TO "staff_employmentTypeId_fkey";

-- RenameForeignKey
ALTER TABLE "staff_day_preferences" RENAME CONSTRAINT "provider_day_preferences_providerId_fkey" TO "staff_day_preferences_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "staff_eligible_shifts" RENAME CONSTRAINT "provider_eligible_shifts_providerId_fkey" TO "staff_eligible_shifts_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "staff_eligible_shifts" RENAME CONSTRAINT "provider_eligible_shifts_shiftTypeId_fkey" TO "staff_eligible_shifts_shiftTypeId_fkey";

-- RenameForeignKey
ALTER TABLE "staff_shift_overrides" RENAME CONSTRAINT "provider_shift_overrides_providerId_fkey" TO "staff_shift_overrides_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "staff_shift_overrides" RENAME CONSTRAINT "provider_shift_overrides_shiftTypeId_fkey" TO "staff_shift_overrides_shiftTypeId_fkey";

-- RenameForeignKey
ALTER TABLE "standing_commitments" RENAME CONSTRAINT "standing_commitments_providerId_fkey" TO "standing_commitments_staffId_fkey";

-- RenameForeignKey
ALTER TABLE "users" RENAME CONSTRAINT "users_providerId_fkey" TO "users_staffId_fkey";

-- AddForeignKey
ALTER TABLE "shift_follow_rules" ADD CONSTRAINT "shift_follow_rules_sourceShiftId_fkey" FOREIGN KEY ("sourceShiftId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_follow_rules" ADD CONSTRAINT "shift_follow_rules_allowedShiftId_fkey" FOREIGN KEY ("allowedShiftId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "assignments_providerId_date_key" RENAME TO "assignments_staffId_date_key";

-- RenameIndex
ALTER INDEX "schedule_requests_providerId_startDate_endDate_idx" RENAME TO "schedule_requests_staffId_startDate_endDate_idx";

-- RenameIndex
ALTER INDEX "shift_eligibility_rules_providerId_shiftTypeId_idx" RENAME TO "shift_eligibility_rules_staffId_shiftTypeId_idx";

-- RenameIndex
ALTER INDEX "providers_initials_key" RENAME TO "staff_initials_key";

-- RenameIndex
ALTER INDEX "provider_day_preferences_providerId_dayOfWeek_key" RENAME TO "staff_day_preferences_staffId_dayOfWeek_key";

-- RenameIndex
ALTER INDEX "provider_eligible_shifts_providerId_shiftTypeId_key" RENAME TO "staff_eligible_shifts_staffId_shiftTypeId_key";

-- RenameIndex
ALTER INDEX "provider_shift_overrides_providerId_shiftTypeId_key" RENAME TO "staff_shift_overrides_staffId_shiftTypeId_key";

-- RenameIndex
ALTER INDEX "users_providerId_key" RENAME TO "users_staffId_key";

