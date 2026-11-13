-- Card #178: per-shift "Spread over the month" (additive; old code ignores it).
ALTER TABLE "shift_types" ADD COLUMN "spreadOverMonth" BOOLEAN NOT NULL DEFAULT false;
