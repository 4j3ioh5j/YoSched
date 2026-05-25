-- CreateTable
CREATE TABLE "shift_eligibility_rules" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'eligible',
    "strength" TEXT NOT NULL DEFAULT 'rule',
    "pattern" TEXT NOT NULL DEFAULT 'every',
    "cycleLength" INTEGER,
    "cycleOffset" INTEGER,

    CONSTRAINT "shift_eligibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_minimum_targets" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "shiftTypeId" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL,
    "window" TEXT NOT NULL,
    "windowDays" INTEGER,

    CONSTRAINT "shift_minimum_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_eligibility_rules_providerId_shiftTypeId_idx" ON "shift_eligibility_rules"("providerId", "shiftTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_minimum_targets_providerId_shiftTypeId_window_key" ON "shift_minimum_targets"("providerId", "shiftTypeId", "window");

-- AddForeignKey
ALTER TABLE "shift_eligibility_rules" ADD CONSTRAINT "shift_eligibility_rules_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_eligibility_rules" ADD CONSTRAINT "shift_eligibility_rules_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_minimum_targets" ADD CONSTRAINT "shift_minimum_targets_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_minimum_targets" ADD CONSTRAINT "shift_minimum_targets_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
