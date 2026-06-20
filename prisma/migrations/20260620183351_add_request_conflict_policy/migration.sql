-- Auto-scheduler resolution of forced REQUEST_SHIFTs that contend for a scarce slot
-- or exceed a requester's pay-period hour cap: "reconcile" | "honor-always".
-- "reconcile" (default): place requests tentatively, then confirm only the conflict-free
-- ones at the end (first-come by receivedAt wins), revoking + backfilling the rest.
-- "honor-always": pre-#221 behavior (place forced requests first and keep them).
-- Additive, NOT NULL with a default so existing rows backfill to the new default.
ALTER TABLE "scheduling_preferences" ADD COLUMN "requestConflictPolicy" TEXT NOT NULL DEFAULT 'reconcile';
