-- Card #299: the year export's file name template. Additive and nullable (null = the
-- built-in default), so rollback is code-only.
ALTER TABLE "scheduling_preferences" ADD COLUMN "exportFileName" TEXT;
