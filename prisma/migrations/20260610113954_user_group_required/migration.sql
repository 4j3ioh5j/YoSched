-- Make every user's group mandatory and protect members from group deletion.
--
-- Authorization in YoSched is entirely group-based; the legacy User.role field is only a
-- fallback for ungrouped users, and there are none (verified 0 rows with groupId IS NULL
-- before applying). This enforces the "every user has a group" invariant at the database
-- level so the role fallback can be removed (follow-up slices).
--
-- Also switch the FK from ON DELETE SET NULL to ON DELETE RESTRICT: a group can no longer
-- be deleted out from under its members (the app already blocks deleting a non-empty group;
-- this is defense in depth, and SET NULL would violate the new NOT NULL constraint anyway).

ALTER TABLE "users" ALTER COLUMN "groupId" SET NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT "users_groupId_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
