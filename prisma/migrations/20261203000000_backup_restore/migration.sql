-- Card #314: backup and restore. Additive only; rollback is code-only.
ALTER TABLE "scheduling_preferences" ADD COLUMN "backupReminderDays" INTEGER NOT NULL DEFAULT 7;

CREATE TABLE "backup_status" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "lastBackupAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "backup_status_pkey" PRIMARY KEY ("id")
);

-- "Back up and restore all data" goes to the Admin-level groups (level 3) only. Fresh
-- installs get it via the seed (Admin is seeded with the whole catalog). Idempotent.
UPDATE "groups"
   SET "permissions" = array_append("permissions", 'data:backup')
 WHERE "level" >= 3
   AND NOT ('data:backup' = ANY("permissions"));
