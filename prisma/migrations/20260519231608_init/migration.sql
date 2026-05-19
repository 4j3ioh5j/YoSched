-- CreateTable
CREATE TABLE "shift_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "defaultHours" DOUBLE PRECISION NOT NULL,
    "countsTowardFte" BOOLEAN NOT NULL DEFAULT true,
    "isLeave" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL DEFAULT 'work',
    "postShiftRule" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_type_roles" (
    "id" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "shift_type_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL DEFAULT 'fte',
    "ftePercentage" DOUBLE PRECISION DEFAULT 1.0,
    "fteSplit" JSONB,
    "feeBasisHoursPerShift" DOUBLE PRECISION,
    "role" TEXT,
    "specialQualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "takesCall" BOOLEAN NOT NULL DEFAULT true,
    "takesLate" BOOLEAN NOT NULL DEFAULT true,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,
    "tempStartDate" TIMESTAMP(3),
    "tempEndDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_shift_overrides" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "durationHrs" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "provider_shift_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_day_preferences" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "preference" TEXT NOT NULL,

    CONSTRAINT "provider_day_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_commitments" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "notes" TEXT,

    CONSTRAINT "standing_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desirability_weights" (
    "id" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "reason" TEXT,

    CONSTRAINT "desirability_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staffing_minimums" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "minimumCount" INTEGER NOT NULL,

    CONSTRAINT "staffing_minimums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_periods" (
    "id" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "targetHours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_types_code_key" ON "shift_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shift_type_roles_shiftTypeId_role_key" ON "shift_type_roles"("shiftTypeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "providers_initials_key" ON "providers"("initials");

-- CreateIndex
CREATE UNIQUE INDEX "provider_shift_overrides_providerId_shiftTypeId_key" ON "provider_shift_overrides"("providerId", "shiftTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_day_preferences_providerId_dayOfWeek_key" ON "provider_day_preferences"("providerId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "desirability_weights_shiftTypeId_dayOfWeek_key" ON "desirability_weights"("shiftTypeId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "staffing_minimums_role_dayType_key" ON "staffing_minimums"("role", "dayType");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_providerId_date_key" ON "assignments"("providerId", "date");

-- AddForeignKey
ALTER TABLE "shift_type_roles" ADD CONSTRAINT "shift_type_roles_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_shift_overrides" ADD CONSTRAINT "provider_shift_overrides_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_shift_overrides" ADD CONSTRAINT "provider_shift_overrides_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_day_preferences" ADD CONSTRAINT "provider_day_preferences_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_commitments" ADD CONSTRAINT "standing_commitments_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_commitments" ADD CONSTRAINT "standing_commitments_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desirability_weights" ADD CONSTRAINT "desirability_weights_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
