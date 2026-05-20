-- CreateTable
CREATE TABLE "fte_targets" (
    "id" TEXT NOT NULL,
    "ftePercentage" DOUBLE PRECISION NOT NULL,
    "targetHours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "fte_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fte_targets_ftePercentage_key" ON "fte_targets"("ftePercentage");
