-- Card #367: saved questions for the "Ask" page. A new table only, so the old code ignores it.
-- Rollback: code-only. To remove: DROP TABLE "saved_questions";
CREATE TABLE "saved_questions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "ownerId" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_questions_ownerId_idx" ON "saved_questions"("ownerId");
CREATE INDEX "saved_questions_isShared_idx" ON "saved_questions"("isShared");

ALTER TABLE "saved_questions" ADD CONSTRAINT "saved_questions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
