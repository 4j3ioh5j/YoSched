// Card #467: "Even OR staffing across days". For one pay period's counted dates with fill-shift
// headcounts c, the spread n·Σc² − (Σc)² (n² times the variance): 0 when every day has the same
// count, larger as days pile up. Integer for integer counts, so equal schedules compare equal.
export function dayBalanceSpread(counts: readonly number[]): number {
  const n = counts.length;
  if (n < 2) return 0;
  let sum = 0;
  let sumSq = 0;
  for (const c of counts) {
    sum += c;
    sumSq += c * c;
  }
  return n * sumSq - sum * sum;
}
