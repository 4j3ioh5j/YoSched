-- AlterTable
ALTER TABLE "shift_types" ADD COLUMN "hotkey" TEXT;

-- Set default hotkeys for existing shifts
UPDATE "shift_types" SET "hotkey" = 'C' WHERE "code" = 'ORC';
UPDATE "shift_types" SET "hotkey" = 'L' WHERE "code" = 'ORL';
UPDATE "shift_types" SET "hotkey" = 'W' WHERE "code" = 'CALL';
UPDATE "shift_types" SET "hotkey" = 'A' WHERE "code" = 'AL';
UPDATE "shift_types" SET "hotkey" = 'S' WHERE "code" = 'SL';
UPDATE "shift_types" SET "hotkey" = 'X' WHERE "code" = 'X';
UPDATE "shift_types" SET "hotkey" = 'D' WHERE "code" = 'ADM';
UPDATE "shift_types" SET "hotkey" = 'H' WHERE "code" = 'CARD';
UPDATE "shift_types" SET "hotkey" = 'I' WHERE "code" = 'ICU';
UPDATE "shift_types" SET "hotkey" = 'L' WHERE "code" = 'ILD';
UPDATE "shift_types" SET "hotkey" = 'J' WHERE "code" = 'JD';
UPDATE "shift_types" SET "hotkey" = 'P' WHERE "code" = 'PREOP';
UPDATE "shift_types" SET "hotkey" = 'Q' WHERE "code" = 'QA';
UPDATE "shift_types" SET "hotkey" = 'N' WHERE "code" = 'PAIN';
UPDATE "shift_types" SET "hotkey" = 'U' WHERE "code" = 'UCLA';
UPDATE "shift_types" SET "hotkey" = 'R' WHERE "code" = 'RS';
UPDATE "shift_types" SET "hotkey" = 'T' WHERE "code" = 'CITC';
