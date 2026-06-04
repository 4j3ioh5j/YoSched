-- CreateTable
CREATE TABLE "schedule_versions" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "comment" TEXT,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "isAutoBackup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_versions_year_month_idx" ON "schedule_versions"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_versions_year_month_versionNumber_key" ON "schedule_versions"("year", "month", "versionNumber");
