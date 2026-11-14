-- Card #204: the hidden staff day preferences ("Tuesday: ORC", no screen showed them) become the
-- visible staff-card rule "eligible · Prefer" on that weekday. Data only; the old table is left
-- in place, unread, so a code rollback still finds it. Ids are explicit (Prisma's cuid() default
-- is application-side) and deterministic, so a re-run inserts nothing new. A preference whose
-- shift code no longer exists is skipped: it already did nothing (the old reader matched codes).
INSERT INTO "shift_eligibility_rules"
  ("id", "staffId", "shiftTypeId", "type", "strength", "whenKind", "whenDays", "whenPpWeek", "whenOrds", "whenCycleUnit", "whenCycleN", "whenCycleOffset")
SELECT 'dp' || md5(p."id"), p."staffId", st."id", 'eligible', 'preference', 'every', ARRAY[p."dayOfWeek"], NULL, '{}', NULL, NULL, NULL
FROM "staff_day_preferences" p
JOIN "shift_types" st ON st."code" = p."preference"
WHERE NOT EXISTS (
  SELECT 1 FROM "shift_eligibility_rules" r
  WHERE r."staffId" = p."staffId" AND r."shiftTypeId" = st."id" AND r."type" = 'eligible'
    AND r."strength" = 'preference' AND r."whenKind" = 'every' AND r."whenDays" = ARRAY[p."dayOfWeek"]
)
ON CONFLICT ("id") DO NOTHING;
