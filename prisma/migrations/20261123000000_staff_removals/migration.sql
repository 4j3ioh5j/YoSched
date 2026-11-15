-- Card #220: a hard staff remove keeps a snapshot of everything it deletes, so Undo can bring
-- back the same person (same id, rules, requests, links). Additive; rollback is code-only.
CREATE TABLE "staff_removals" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "staff_removals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_removals_staffId_idx" ON "staff_removals"("staffId");
