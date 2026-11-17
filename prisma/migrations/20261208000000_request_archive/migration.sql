-- Card #332: Requests archive settings and per-day notes on archived lines (additive; old code ignores them).
-- Rollback: code-only. To remove: DROP TABLE "request_day_notes"; ALTER TABLE "scheduling_preferences" DROP COLUMN "requestArchiveDays", DROP COLUMN "archiveLeaveMetBy";
ALTER TABLE "scheduling_preferences" ADD COLUMN "requestArchiveDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scheduling_preferences" ADD COLUMN "archiveLeaveMetBy" TEXT NOT NULL DEFAULT 'any-off';

CREATE TABLE "request_day_notes" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "request_day_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "request_day_notes_staffId_date_key" ON "request_day_notes"("staffId", "date");
ALTER TABLE "request_day_notes" ADD CONSTRAINT "request_day_notes_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
