-- CreateTable
CREATE TABLE "autogen_priority_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" JSONB NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autogen_priority_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "autogen_priority_profiles_createdById_idx" ON "autogen_priority_profiles"("createdById");

-- AddForeignKey
ALTER TABLE "autogen_priority_profiles" ADD CONSTRAINT "autogen_priority_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
