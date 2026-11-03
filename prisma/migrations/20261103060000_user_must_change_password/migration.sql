-- Forced password change at next sign-in (admin-set or generated passwords). Additive; old code ignores it.
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
