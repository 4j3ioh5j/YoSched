-- CreateTable
CREATE TABLE "shift_count_rules" (
    "id" TEXT NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "exactCount" INTEGER NOT NULL,

    CONSTRAINT "shift_count_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_count_rules_shiftCode_dayType_key" ON "shift_count_rules"("shiftCode", "dayType");
