-- CreateTable
CREATE TABLE "autogen_factors" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hardness" TEXT NOT NULL DEFAULT 'soft',

    CONSTRAINT "autogen_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autogen_factors_key_key" ON "autogen_factors"("key");

-- Seed the four current aggregate tiers in today's lexicographic order (#252, Slice 1).
-- These are fixed system defaults (= the previously-hardcoded rank[] order), seeded here
-- because deploy runs `migrate deploy` only (not the app seed). The engine independently
-- falls back to this same order if the table is ever empty, so absence is non-fatal.
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness") VALUES
    ('agf_coverage_hardlimits', 'coverageAndHardLimits', 'Coverage & hard staffing limits', 0, true, 'soft'),
    ('agf_pp_hours',            'ppHours',               'Pay-period hours balance',         1, true, 'soft'),
    ('agf_requests',            'requests',              'Requested shifts honored',         2, true, 'soft'),
    ('agf_fairness',            'fairness',              'Fairness / equity spread',         3, true, 'soft');
