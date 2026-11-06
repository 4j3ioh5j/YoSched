-- Rollback for migration 20261106110000_drop_shift_count_rules (card #62). Re-creates the table exactly as
-- 20260520025235 did and re-inserts the six seed rows (the only rows the table ever held: seed.ts upserted them
-- and nothing else wrote to it — verified on staging before the drop). Forgets the drop in Prisma's history so a
-- later deploy re-applies it. Re-runnable (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- Usage on the VM: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261106110000_restore_shift_count_rules.sql
BEGIN;
CREATE TABLE IF NOT EXISTS "shift_count_rules" (
    "id" TEXT NOT NULL,
    "shiftCode" TEXT NOT NULL,
    "dayType" TEXT NOT NULL,
    "exactCount" INTEGER NOT NULL,
    CONSTRAINT "shift_count_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "shift_count_rules_shiftCode_dayType_key" ON "shift_count_rules"("shiftCode", "dayType");
INSERT INTO "shift_count_rules" ("id", "shiftCode", "dayType", "exactCount") VALUES
  ('scr-ORC-weekday', 'ORC', 'weekday', 1),
  ('scr-ORC-holiday', 'ORC', 'holiday', 1),
  ('scr-ORC-weekend', 'ORC', 'weekend', 0),
  ('scr-ORL-weekday', 'ORL', 'weekday', 1),
  ('scr-ORL-holiday', 'ORL', 'holiday', 0),
  ('scr-ORL-weekend', 'ORL', 'weekend', 0)
ON CONFLICT ("shiftCode", "dayType") DO NOTHING;
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106110000_drop_shift_count_rules';
COMMIT;
