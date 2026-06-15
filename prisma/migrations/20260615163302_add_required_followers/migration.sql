-- CreateTable: required_followers (what MUST follow a shift; complements shift_follow_rules)
CREATE TABLE "required_followers" (
    "id" TEXT NOT NULL,
    "sourceShiftId" TEXT NOT NULL,
    "followerShiftId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'each_day',
    "countsTowardTargets" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "required_followers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: at most one required follower per source shift
CREATE UNIQUE INDEX "required_followers_sourceShiftId_key" ON "required_followers"("sourceShiftId");

-- AddForeignKey
ALTER TABLE "required_followers" ADD CONSTRAINT "required_followers_sourceShiftId_fkey" FOREIGN KEY ("sourceShiftId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "required_followers" ADD CONSTRAINT "required_followers_followerShiftId_fkey" FOREIGN KEY ("followerShiftId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed editable defaults (admin can change/remove in settings). Code-independent:
-- inserts nothing if the referenced shift codes don't exist in this deployment.
-- ORC -> X each day (migrates the former hardcoded recovery-day behavior).
INSERT INTO "required_followers" ("id","sourceShiftId","followerShiftId","scope","countsTowardTargets")
SELECT gen_random_uuid()::text, s.id, f.id, 'each_day', false
FROM "shift_types" s JOIN "shift_types" f ON f.code = 'X'
WHERE s.code = 'ORC'
ON CONFLICT ("sourceShiftId") DO NOTHING;

-- CALL -> ADM once per consecutive run (the always-an-ADM-after-call rule).
INSERT INTO "required_followers" ("id","sourceShiftId","followerShiftId","scope","countsTowardTargets")
SELECT gen_random_uuid()::text, s.id, f.id, 'each_run', false
FROM "shift_types" s JOIN "shift_types" f ON f.code = 'ADM'
WHERE s.code = 'CALL'
ON CONFLICT ("sourceShiftId") DO NOTHING;
