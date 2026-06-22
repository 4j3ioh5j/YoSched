-- Default re-solve scope for auto-generate (Live) edits. Additive + default-valued,
-- so existing rows backfill to 'day' (the chosen out-of-the-box default). Values:
-- 'limited' | 'day' | 'pp' | 'range' (#248). Seeds the grid's scope selector only.
ALTER TABLE "scheduling_preferences" ADD COLUMN "defaultLiveScope" TEXT NOT NULL DEFAULT 'day';
