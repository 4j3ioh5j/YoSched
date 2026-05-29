-- Seed default groups
INSERT INTO "groups" ("id", "name", "permissions", "level", "isSystem", "permissionsLocked", "createdAt", "updatedAt")
VALUES
  ('grp_' || substr(gen_random_uuid()::text, 1, 25), 'Admin',
   ARRAY['schedule:view','schedule:edit','schedule:auto','staff:view','staff:edit','statistics:view','settings:view','settings:edit','users:view','users:edit','groups:view','groups:edit'],
   3, true, true, NOW(), NOW()),
  ('grp_' || substr(gen_random_uuid()::text, 1, 25), 'Super User',
   ARRAY['schedule:view','schedule:edit','schedule:auto','staff:view','staff:edit','statistics:view','settings:view','settings:edit','users:view','users:edit','groups:view','groups:edit'],
   2, true, true, NOW(), NOW()),
  ('grp_' || substr(gen_random_uuid()::text, 1, 25), 'Scheduler',
   ARRAY['schedule:view','schedule:edit','schedule:auto','staff:view','staff:edit','statistics:view','settings:view','settings:edit'],
   1, true, false, NOW(), NOW()),
  ('grp_' || substr(gen_random_uuid()::text, 1, 25), 'Staff',
   ARRAY['schedule:view','statistics:view','settings:view'],
   0, true, false, NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;

-- Backfill existing users based on current role
UPDATE "users" SET "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'Admin') WHERE "role" = 'admin' AND "groupId" IS NULL;
UPDATE "users" SET "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'Super User') WHERE "role" = 'manager' AND "groupId" IS NULL;
UPDATE "users" SET "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'Staff') WHERE "role" = 'viewer' AND "groupId" IS NULL;
