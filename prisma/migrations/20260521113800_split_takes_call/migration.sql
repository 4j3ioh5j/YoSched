-- Add takesWeekendCall to providers, defaulting to current takesCall value
ALTER TABLE "providers" ADD COLUMN "takesWeekendCall" BOOLEAN NOT NULL DEFAULT true;
UPDATE "providers" SET "takesWeekendCall" = "takesCall";

-- Add defaultTakesWeekendCall to employment_types
ALTER TABLE "employment_types" ADD COLUMN "defaultTakesWeekendCall" BOOLEAN NOT NULL DEFAULT true;
UPDATE "employment_types" SET "defaultTakesWeekendCall" = "defaultTakesCall";

-- Update CALL shift type to use new eligibility rule
UPDATE "shift_types" SET "eligibilityRule" = 'takesWeekendCall' WHERE code = 'CALL';
