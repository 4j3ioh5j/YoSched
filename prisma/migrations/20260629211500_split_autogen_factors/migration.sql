-- Slice 2a (handoff #376): split the two aggregate auto-gen priority factors into the
-- independently-rankable keys the engine now grades on:
--   coverageAndHardLimits → hardLimits + coverage
--   ppHours               → overHours  + underHours
-- (requests / fairness are unchanged.)
--
-- EXPAND IN PLACE (Codex #1779 W): we do NOT reset every install to the new default.
-- Each aggregate row's CURRENT sortOrder is preserved — an admin who has already
-- reordered on staging keeps that order, with the split children landing in its slot.
-- Within a block the children take a conservative default sub-order: hard caps protected
-- (hardLimits before coverage) and the over side before the under side. A fresh install
-- ran the previous migration first, so it expands the seeded default into:
--   hardLimits > coverage > overHours > underHours > requests > fairness
-- which matches DEFAULT_FACTOR_ORDER in auto-scheduler.ts.
--
-- `enabled` is carried over from each parent; underHours is seeded "hardOverridable"
-- (inert until Slice 2c surfaces under-target hours as an acceptable shortage).

-- coverageAndHardLimits → hardLimits (sub-order 0), coverage (sub-order 1)
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness")
SELECT 'agf_hardlimits', 'hardLimits', 'Hard per-staff limits (min / max)', "sortOrder" * 10 + 0, "enabled", 'soft'
  FROM "autogen_factors" WHERE "key" = 'coverageAndHardLimits';
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness")
SELECT 'agf_coverage', 'coverage', 'Coverage (required staff per shift)', "sortOrder" * 10 + 1, "enabled", 'soft'
  FROM "autogen_factors" WHERE "key" = 'coverageAndHardLimits';

-- ppHours → overHours (sub-order 0), underHours (sub-order 1)
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness")
SELECT 'agf_over_hours', 'overHours', 'Pay-period hours — over target', "sortOrder" * 10 + 0, "enabled", 'soft'
  FROM "autogen_factors" WHERE "key" = 'ppHours';
INSERT INTO "autogen_factors" ("id", "key", "label", "sortOrder", "enabled", "hardness")
SELECT 'agf_under_hours', 'underHours', 'Pay-period hours — under target', "sortOrder" * 10 + 1, "enabled", 'hardOverridable'
  FROM "autogen_factors" WHERE "key" = 'ppHours';

-- Keep requests / fairness in their existing relative position within the widened scale.
UPDATE "autogen_factors" SET "sortOrder" = "sortOrder" * 10 WHERE "key" IN ('requests', 'fairness');

-- Drop the now-replaced aggregate rows.
DELETE FROM "autogen_factors" WHERE "key" IN ('coverageAndHardLimits', 'ppHours');

-- Renumber to a clean contiguous 0..N keyed by the derived order.
WITH ranked AS (
  SELECT "id", (ROW_NUMBER() OVER (ORDER BY "sortOrder", "key") - 1) AS rn
    FROM "autogen_factors"
)
UPDATE "autogen_factors" af
   SET "sortOrder" = ranked.rn
  FROM ranked
 WHERE af."id" = ranked."id";
