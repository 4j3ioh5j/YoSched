-- Card #300: admin-set order of the special schedule columns (additive; null = built-in order).
ALTER TABLE "scheduling_preferences" ADD COLUMN "specialColumnOrder" JSONB;
