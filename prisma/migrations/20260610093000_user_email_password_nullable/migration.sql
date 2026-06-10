-- Make User.email and User.passwordHash nullable.
--
-- Foundation for eager login provisioning (docs/staff-users-linking-plan.md): every
-- active staff member gets a DISABLED shell login with no email/password yet, which an
-- admin later completes. The @unique index on email is unaffected — Postgres treats
-- NULLs as distinct, so many un-provisioned shells coexist; uniqueness is enforced once
-- a real email is set. All three passwordHash compare() sites are guarded against null
-- (auth.ts, pre-check, password change) so a shell can never authenticate.

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
