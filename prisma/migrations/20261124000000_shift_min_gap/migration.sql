-- Card #260: minimum days between two of the same shift for one person (off unless set).
ALTER TABLE "shift_types" ADD COLUMN "minGapDays" INTEGER;
ALTER TABLE "shift_types" ADD COLUMN "minGapStrength" TEXT NOT NULL DEFAULT 'preference';
