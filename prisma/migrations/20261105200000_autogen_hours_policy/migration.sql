-- Pay-period hours policy on the overHours / underHours priority rows (prohibited | discouraged | allowed).
-- Additive and nullable; NULL means "discouraged" (rank decides). Old code ignores it.
ALTER TABLE "autogen_factors" ADD COLUMN "hoursPolicy" TEXT;
