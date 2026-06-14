-- Per-column condition scope for the printed-schedule aggregate columns.
-- "month" (default) = evaluate shift conditions over the whole printed month (current
-- behavior); "day" = evaluate per day, listing a member only on days whose shift
-- satisfies the conditions. Additive with a default → no existing printout changes.

-- AlterTable
ALTER TABLE "print_aggregate_columns" ADD COLUMN "conditionScope" TEXT NOT NULL DEFAULT 'month';
