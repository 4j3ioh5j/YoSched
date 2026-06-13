-- Richer shift conditions for print column rules (ANDed array of
-- { quantifier, categories, codes, except }). Additive; existing legacy
-- shiftCodes/shiftMatch columns remain and are synthesized into a condition on read.
ALTER TABLE "print_column_rules" ADD COLUMN "conditions" JSONB NOT NULL DEFAULT '[]';
