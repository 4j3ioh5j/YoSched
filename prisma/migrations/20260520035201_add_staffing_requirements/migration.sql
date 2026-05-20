-- CreateTable
CREATE TABLE "staffing_requirements" (
    "id" TEXT NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "staffing_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staffing_requirements_shiftCode_dayKey_key" ON "staffing_requirements"("shiftCode", "dayKey");
