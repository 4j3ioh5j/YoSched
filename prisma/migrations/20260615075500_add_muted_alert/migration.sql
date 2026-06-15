-- Dismissed ("muted") schedule alerts. Shared across all logins (single-tenant)
-- so silencing a known/intentional alert sticks for everyone. `alertKey` is a
-- stable, value-bearing identity built by src/lib/alerts.ts — it embeds the
-- alert's numbers, so when the underlying value changes the key changes and the
-- alert re-surfaces. Additive; no existing table is touched.

-- CreateTable
CREATE TABLE "muted_alerts" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "mutedBy" TEXT,
    "mutedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "muted_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "muted_alerts_alertKey_key" ON "muted_alerts"("alertKey");
