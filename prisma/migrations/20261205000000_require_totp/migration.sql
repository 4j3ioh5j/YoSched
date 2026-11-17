-- Card #319: required two-factor login. Additive only; rollback is code-only (the old code
-- ignores the new columns and table; its exporter would include auth_state, which the new
-- reader ignores rather than refuses).
ALTER TABLE "scheduling_preferences" ADD COLUMN "requireTotp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- The install's auth epoch: signed into every session and trusted-device cookie, rotated by
-- every restore, never backed up. A restore that brings back an older sessionVersion can't
-- revive a token issued before it.
CREATE TABLE "auth_state" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "epoch" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_state_pkey" PRIMARY KEY ("id")
);
-- Created here so reading it never has to write (page loads don't hold the write gate).
-- gen_random_uuid() is built in (Postgres 13+) and draws from a strong random source.
INSERT INTO "auth_state" ("id", "epoch") VALUES ('default', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
