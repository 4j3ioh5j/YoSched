-- Configurable aggregate columns for the printed schedule (replaces the hardcoded
-- "FB" collapse column). Additive. Seeds the singleton residual "Other" column.

-- CreateTable
CREATE TABLE "print_aggregate_columns" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "suppressMembers" BOOLEAN NOT NULL DEFAULT true,
    "isOther" BOOLEAN NOT NULL DEFAULT false,
    "employmentTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minFtePercentage" DOUBLE PRECISION,
    "maxFtePercentage" DOUBLE PRECISION,
    "conditions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "print_aggregate_columns_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton residual catch-all "Other" column. Enabled, but the grid renders
-- it only when it has members in the printed period, so this changes no existing
-- printout on migration. Fixed id keeps the seed idempotent and identifiable.
INSERT INTO "print_aggregate_columns"
    ("id", "label", "sortOrder", "enabled", "suppressMembers", "isOther", "conditions")
VALUES
    ('aggcol_other_default', 'Other', 0, true, false, true, '[]');
