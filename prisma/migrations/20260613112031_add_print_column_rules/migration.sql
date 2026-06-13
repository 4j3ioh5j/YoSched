-- CreateTable
CREATE TABLE "print_column_rules" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'include',
    "employmentTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minFtePercentage" DOUBLE PRECISION,
    "maxFtePercentage" DOUBLE PRECISION,
    "shiftCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shiftMatch" TEXT NOT NULL DEFAULT 'any',

    CONSTRAINT "print_column_rules_pkey" PRIMARY KEY ("id")
);
