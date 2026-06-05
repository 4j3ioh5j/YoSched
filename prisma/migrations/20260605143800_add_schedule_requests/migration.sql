-- CreateTable
CREATE TABLE "schedule_requests" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "shiftTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leaveShiftTypeId" TEXT,
    "strength" TEXT NOT NULL DEFAULT 'hard',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'scheduler',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_requests_providerId_startDate_endDate_idx" ON "schedule_requests"("providerId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "schedule_requests_status_idx" ON "schedule_requests"("status");

-- AddForeignKey
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_requests" ADD CONSTRAINT "schedule_requests_leaveShiftTypeId_fkey" FOREIGN KEY ("leaveShiftTypeId") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
