-- Card #189: Hard/Prefer on a person's shift count target. Additive; every existing target stays Hard.
ALTER TABLE "shift_minimum_targets" ADD COLUMN "strength" TEXT NOT NULL DEFAULT 'rule';
