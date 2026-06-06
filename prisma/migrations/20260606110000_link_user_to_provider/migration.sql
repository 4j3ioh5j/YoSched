-- AlterTable: link a login (User) to a Provider record for self-service requests.
ALTER TABLE "users" ADD COLUMN "providerId" TEXT;

-- CreateIndex: one provider maps to at most one login (and vice versa).
CREATE UNIQUE INDEX "users_providerId_key" ON "users"("providerId");

-- AddForeignKey: clearing the provider (or deleting it) just unlinks the login.
ALTER TABLE "users" ADD CONSTRAINT "users_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
