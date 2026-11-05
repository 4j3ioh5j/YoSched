-- Per-day maximum moves from shift_types."maxPerDay" (one value, every day) to
-- staffing_requirements."maxCount" (per shift × day of week / holiday). NULL = no limit.
ALTER TABLE "staffing_requirements" ADD COLUMN "maxCount" INTEGER;

-- Copy every existing cap onto all eight day keys of its shift. Rows that don't exist yet
-- (a capped shift with no Staffing Rules column) are created with min 0 / preferred 0.
-- Ids are explicit: Prisma's cuid() is client-side, not a database default.
INSERT INTO "staffing_requirements" ("id", "shiftCode", "dayKey", "minCount", "preferredCount", "maxCount")
SELECT 'srm_' || md5(st."code" || ':' || k."dayKey" || ':' || clock_timestamp()::text || random()::text),
       st."code", k."dayKey", 0, 0, st."maxPerDay"
FROM "shift_types" st
CROSS JOIN (VALUES ('0'), ('1'), ('2'), ('3'), ('4'), ('5'), ('6'), ('holiday')) AS k("dayKey")
WHERE st."maxPerDay" IS NOT NULL
ON CONFLICT ("shiftCode", "dayKey") DO UPDATE SET "maxCount" = EXCLUDED."maxCount";
