import { prisma } from "@/lib/prisma";
import { periodsCovering } from "./pay-periods";

// Serializes pay-period regeneration across concurrent requests (delete+recreate
// from two racing transactions could otherwise interleave into duplicate rows).
const PAY_PERIOD_LOCK_KEY = 0x59537050; // "YSpP"

type PayPeriodRow = { id: string; startDate: Date; endDate: Date; targetHours: number };

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the stored pay periods, first ensuring they match the ladder defined by
 * the configured anchor + period length over a rolling coverage window (Jan 1 of
 * last year through Dec 31 of next year). The first read of a new year extends
 * coverage automatically — no yearly manual regeneration. When no anchor is
 * configured (legacy installs), the stored rows are returned untouched.
 */
export async function getPayPeriods(): Promise<PayPeriodRow[]> {
  const prefs = await prisma.schedulingPreferences.findFirst();
  if (!prefs?.payPeriodAnchor) {
    return prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  }

  const anchor = dateOnly(prefs.payPeriodAnchor);
  const lengthDays = prefs.payPeriodLengthDays;
  const year = new Date().getUTCFullYear();
  const wanted = periodsCovering(anchor, lengthDays, `${year - 1}-01-01`, `${year + 1}-12-31`);

  const existing = await prisma.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  const matches =
    existing.length === wanted.length &&
    wanted.every((w, i) => dateOnly(existing[i].startDate) === w.startDate && dateOnly(existing[i].endDate) === w.endDate);
  if (matches) return existing;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAY_PERIOD_LOCK_KEY})`;
    // Re-read under the lock: a racing request may have regenerated already.
    const current = await tx.payPeriod.findMany({ orderBy: { startDate: "asc" } });
    const currentMatches =
      current.length === wanted.length &&
      wanted.every((w, i) => dateOnly(current[i].startDate) === w.startDate && dateOnly(current[i].endDate) === w.endDate);
    if (currentMatches) return current;

    const targetHours = current[0]?.targetHours ?? 80;
    await tx.payPeriod.deleteMany({});
    await tx.payPeriod.createMany({
      // Deterministic ids: anything referencing a period by id (equity saved
      // views select payPeriodIds) survives regeneration as long as the
      // period's start date is unchanged — year-rollover extension no longer
      // invalidates references to existing periods.
      data: wanted.map((w) => ({
        id: `pp-${w.startDate}`,
        startDate: new Date(w.startDate + "T00:00:00Z"),
        endDate: new Date(w.endDate + "T00:00:00Z"),
        targetHours,
      })),
    });
    return tx.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  });
}
