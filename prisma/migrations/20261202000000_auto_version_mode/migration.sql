-- Card #312: Print / Export save a version first when a month changed. Additive with a
-- default, so rollback is code-only (an old server never reads the column).
ALTER TABLE "scheduling_preferences" ADD COLUMN "autoVersionMode" TEXT NOT NULL DEFAULT 'auto';
