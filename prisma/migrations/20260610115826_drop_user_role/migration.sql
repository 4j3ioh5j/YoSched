-- Drop the legacy User.role column and the Role enum.
--
-- Authorization is entirely group-based (every user has a group — groupId NOT NULL since
-- 20260610113954_user_group_required), and slice 2 removed every read/write of role from
-- the application. The column + enum are now unreferenced, so remove them. No other table
-- uses the Role enum (the scheduling "role" fields are plain text), so the type drops clean.

ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "Role";
