-- Last-seen heartbeat per login. Powers ONLY the passive "other editors are active"
-- banner on the schedule page. One row per user (PK = userId), upserted on each
-- heartbeat. Not a session store and not a page tracker: it records that a login is
-- active *somewhere*, and "active" is decided at read time by a freshness TTL
-- (src/lib/presence.ts), so a closed tab silently ages out. Additive; no existing
-- table is touched. No FK back to users — presence is disposable and must never block
-- a user delete; a stale row is harmless and is overwritten on that user's next login.

-- CreateTable
CREATE TABLE "user_activity" (
    "userId" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "user_activity_lastSeen_idx" ON "user_activity"("lastSeen");
