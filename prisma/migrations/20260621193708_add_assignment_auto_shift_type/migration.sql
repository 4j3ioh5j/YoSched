-- Records the ShiftType.id the Auto-schedule run originally placed in a cell,
-- captured only when a manual edit later overwrites a source="auto" assignment
-- with a different value. Lets the cell tooltip render "Auto → Manual (was X)".
--
-- Nullable on purpose and NOT a foreign key (mirrors updatedBy): deleting a
-- ShiftType must never cascade-delete assignment history. NULL for cells that
-- were never auto, for unedited auto cells, and for rows a fresh auto run
-- (re)writes. No backfill needed; not indexed (read per-row for display only).
ALTER TABLE "assignments" ADD COLUMN "autoShiftTypeId" TEXT;
