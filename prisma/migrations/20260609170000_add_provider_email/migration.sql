-- Optional contact email on a staff member (provider). Nullable: existing rows
-- have no email and most staff may never get one. Independent of the linked
-- login User's email (the User.providerId relation) — reconciling the two is
-- deferred to the Staff<->Users linking rework.
ALTER TABLE "providers" ADD COLUMN "email" TEXT;
