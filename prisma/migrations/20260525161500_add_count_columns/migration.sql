-- CreateTable
CREATE TABLE "count_columns" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "shiftCodes" TEXT[],

    CONSTRAINT "count_columns_pkey" PRIMARY KEY ("id")
);
