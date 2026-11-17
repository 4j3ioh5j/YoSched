-- Card #315: automatic daily backups. Additive only; rollback is code-only (the old code
-- ignores the new table and columns; a backup made by the new code holds backup_settings,
-- which an old YoSched refuses as "a table this YoSched doesn't have").
CREATE TABLE "backup_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "autoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoTime" TEXT NOT NULL DEFAULT '02:00',
    "keepDaily" INTEGER NOT NULL DEFAULT 7,
    "keepWeekly" INTEGER NOT NULL DEFAULT 4,
    "keepMonthly" INTEGER NOT NULL DEFAULT 12,
    "keepSafety" INTEGER NOT NULL DEFAULT 10,
    "publicKey" TEXT,
    "keyId" TEXT,
    "keyCreatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "pendingPublicKey" TEXT,
    "pendingKeyId" TEXT,
    "pendingKeyCreatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "backup_status" ADD COLUMN "lastAutoSuccessAt" TIMESTAMP(3);
ALTER TABLE "backup_status" ADD COLUMN "lastAutoAttemptAt" TIMESTAMP(3);
ALTER TABLE "backup_status" ADD COLUMN "lastAutoError" TEXT;
