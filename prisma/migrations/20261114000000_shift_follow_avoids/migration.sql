-- Card #177: soft "avoid" follow rules (avoid shift B the day after shift A).
-- A new table: code without it ignores it, so rollback is code-only.
CREATE TABLE "shift_follow_avoids" (
    "id" TEXT NOT NULL,
    "sourceShiftId" TEXT NOT NULL,
    "avoidShiftId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_follow_avoids_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_follow_avoids_sourceShiftId_avoidShiftId_key" ON "shift_follow_avoids"("sourceShiftId", "avoidShiftId");

ALTER TABLE "shift_follow_avoids" ADD CONSTRAINT "shift_follow_avoids_sourceShiftId_fkey" FOREIGN KEY ("sourceShiftId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_follow_avoids" ADD CONSTRAINT "shift_follow_avoids_avoidShiftId_fkey" FOREIGN KEY ("avoidShiftId") REFERENCES "shift_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
