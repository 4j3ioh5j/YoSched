-- Optional per-shift background color for the PRINTED schedule only (the on-screen
-- grid is unaffected). NULL = no background tint. Additive (nullable, no default) so
-- no existing printout changes except the seeded call/holiday shifts below. Admins can
-- change or clear any value in Settings -> Shift Types -> Print background.
ALTER TABLE "shift_types" ADD COLUMN "printBackgroundColor" TEXT;

-- Seed the requested defaults. CALL/ORC = light blue (HSL 203 49 78), ORL = light
-- green (HSL 87 52 78), HOL = pink (HSL 293 18 88). Stored as hex so the color picker
-- (input type=color) round-trips them. Only touches rows that still hold no value.
UPDATE "shift_types" SET "printBackgroundColor" = '#abcde2' WHERE "code" IN ('CALL', 'ORC') AND "printBackgroundColor" IS NULL;
UPDATE "shift_types" SET "printBackgroundColor" = '#cae4aa' WHERE "code" = 'ORL' AND "printBackgroundColor" IS NULL;
UPDATE "shift_types" SET "printBackgroundColor" = '#e5dbe6' WHERE "code" = 'HOL' AND "printBackgroundColor" IS NULL;
