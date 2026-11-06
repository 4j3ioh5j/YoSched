// Card #67 — the server half of "approving a request on a full day resolves it or flags it".
//
// `resolveApproval` runs the pure decision (src/lib/request-approval-outcome.ts) under the
// assignment writers' lock protocol (src/lib/day-cap-db.ts) and applies its writes, all in ONE
// transaction with the request row's own status change (`finish`), so a flag and its missing
// placement, or an approval and its placement, can never be seen apart.
//
// Range and locks: the engine input covers the pay periods overlapping the request; windowed
// rules (follow rules ±1 day, rolling maxima and per-window minima) read cells just outside
// that, so the lock covers the covering range PADDED by the longest hard rule window on both
// sides, and the cells in the padding are handed to the decision as FIXED context (present in
// the verified grid, never freed, never written). The pad is computed BEFORE the locks from
// the targets then re-computed from the input read under them: a target added in between that
// would need a wider pad makes the approval retry (`ApprovalRetry` → the busy 409) rather than
// decide on an unlocked neighbour.
//
// `getPayPeriods()` runs BEFORE the transaction: it may regenerate the pay-period rows in a
// transaction of its own under its own advisory key, and must never run inside ours. Inside,
// the pay periods are a plain read passed to the input builder.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getPayPeriods } from "@/lib/pay-periods-server";
import { buildAutoScheduleInput, coveringRange, type PayPeriodLike } from "@/lib/build-auto-schedule-input";
import { DAY_CAP_TX, dateKeysBetween, lockDayCaps } from "@/lib/day-cap-db";
import { decideApproval, shiftDate, type ApprovalDecision, type ApprovalRequest, type ContextCell, type RippleCell } from "@/lib/request-approval-outcome";
import { parseApprovalConflictPolicy } from "@/lib/schedule-requests";

/** Thrown inside the transaction when the pad computed under the locks is wider than the one
 *  locked: nothing was written; the route answers busy and the client retries. */
export class ApprovalRetry extends Error {
  constructor() {
    super("approval-retry");
    this.name = "ApprovalRetry";
  }
}

export type TargetWindowLike = { window: string; windowDays?: number | null; windowCount?: number | null; strength?: string | null };

/** Days of context a verification needs on each side of the engine range: at least 1 (follow
 *  rules, required followers), else the longest HARD target window in days. */
export function paddingDays(targets: readonly TargetWindowLike[], payPeriodLengthDays: number): number {
  let pad = 1;
  for (const t of targets) {
    if ((t.strength ?? "rule") !== "rule") continue;
    const n = Math.max(1, Math.floor(t.windowCount ?? 1));
    let days = 0;
    switch (t.window) {
      case "days": days = Math.max(0, t.windowDays ?? 0); break;
      case "week": days = 7 * n; break;
      case "pay_period": days = Math.max(1, payPeriodLengthDays) * n; break;
      case "month": days = 31 * n; break;
    }
    pad = Math.max(pad, days);
  }
  return pad;
}

const at = (date: string) => new Date(date + "T00:00:00Z");
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export type ApprovalFinish<T> = (tx: Prisma.TransactionClient, outcome: ApprovalDecision, ripple: RippleCell[] | null) => Promise<T>;

export type ResolvedApproval<T> = {
  outcome: ApprovalDecision;
  result: T;
  /** The engine range the decision covered ("YYYY-MM-DD", inclusive) and the pad around it. */
  range: { start: string; end: string; pad: number };
};

/** The lock plan for a decision over [startDate, endDate]: the pay-period ladder and the pad,
 *  both read OUTSIDE the transaction (getPayPeriods may write under its own lock). */
export type LockPlan = { pad: number; ppLength: number; effectiveStart: string; effectiveEnd: string; padStart: string; padEnd: string };

export async function planLocks(startDate: string, endDate: string): Promise<LockPlan> {
  const payPeriods: PayPeriodLike[] = await getPayPeriods();
  const [minTargets, deptTargets, prefsBefore] = await Promise.all([
    prisma.shiftMinimumTarget.findMany({ select: { window: true, windowDays: true, windowCount: true } }),
    prisma.departmentShiftTarget.findMany({ select: { window: true, windowDays: true, windowCount: true, strength: true } }),
    prisma.schedulingPreferences.findFirst({ select: { payPeriodLengthDays: true } }),
  ]);
  const ppLength = prefsBefore?.payPeriodLengthDays ?? 14;
  const pad = paddingDays([...minTargets, ...deptTargets], ppLength);
  const { effectiveStart, effectiveEnd } = coveringRange(payPeriods, startDate, endDate);
  return { pad, ppLength, effectiveStart, effectiveEnd, padStart: shiftDate(effectiveStart, -pad), padEnd: shiftDate(effectiveEnd, pad) };
}

/** INSIDE the transaction: take the padded day locks FIRST, then read the engine input and the
 *  fixed context bands under them. Throws ApprovalRetry when what the locks protect drifted. */
/** The padded day locks of a plan. Must be the transaction's FIRST statement. */
export async function lockPlanDays(tx: Prisma.TransactionClient, plan: LockPlan): Promise<void> {
  // dateKeysBetween excludes its end: lock through padEnd
  await lockDayCaps(tx, dateKeysBetween(at(plan.padStart), at(shiftDate(plan.padEnd, 1))));
}

export async function lockAndLoad(tx: Prisma.TransactionClient, startDate: string, endDate: string, plan: LockPlan, opts: { locked?: boolean } = {}) {
  if (!opts.locked) await lockPlanDays(tx, plan);

  const pps = await tx.payPeriod.findMany({ orderBy: { startDate: "asc" } });
  const input = await buildAutoScheduleInput(startDate, endDate, { client: tx, payPeriods: pps });
  const prefs = await tx.schedulingPreferences.findFirst();

  // Re-validate the pad and the range against what the locks actually protect.
  const padNow = paddingDays(
    input.staff.flatMap((s) => s.shiftMinimumTargets ?? []),
    prefs?.payPeriodLengthDays ?? plan.ppLength,
  );
  const first = input.dates[0];
  const last = input.dates[input.dates.length - 1];
  if (padNow > plan.pad || !first || !last || first < plan.effectiveStart || last > plan.effectiveEnd) throw new ApprovalRetry();

  // The fixed context: every cell in the pad bands on both sides of the engine range.
  const contextRows = await tx.assignment.findMany({
    where: {
      OR: [
        { date: { gte: at(plan.padStart), lt: at(first) } },
        { date: { gt: at(last), lte: at(plan.padEnd) } },
      ],
    },
    select: { staffId: true, date: true, shiftTypeId: true, isLocked: true, source: true },
  });
  const context: ContextCell[] = contextRows.map((a) => ({
    staffId: a.staffId,
    date: ymd(a.date),
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    source: a.source,
  }));
  return { input, prefs, first, last, context };
}

export async function resolveApproval<T>(
  req: ApprovalRequest,
  placement: string,
  approverUserId: string | null,
  finish: ApprovalFinish<T>,
): Promise<ResolvedApproval<T>> {
  const plan = await planLocks(req.startDate, req.endDate);

  return prisma.$transaction(async (tx) => {
    const { input, prefs, first, last, context } = await lockAndLoad(tx, req.startDate, req.endDate, plan);

    const policy = parseApprovalConflictPolicy(prefs?.approvalConflictPolicy);
    const outcome = decideApproval(input, req, placement, policy, context);

    let ripple: RippleCell[] | null = null;
    if (outcome.ok) {
      // Card #70: the inverse of EVERY write — the requester's own covered cells included, so an
      // Undo puts back what was there instead of deleting it (a later approval's inverse may
      // expect that earlier value) — read under the locks BEFORE the writes, provenance included.
      const rippleWrites = outcome.writes;
      if (rippleWrites.length > 0) {
        const beforeRows = await tx.assignment.findMany({
          where: { OR: rippleWrites.map((w) => ({ staffId: w.staffId, date: at(w.date) })) },
          select: { staffId: true, date: true, shiftTypeId: true, source: true, autoMonth: true },
        });
        const beforeOf = new Map(beforeRows.map((b) => [`${b.staffId}:${ymd(b.date)}`, b] as const));
        ripple = rippleWrites.map((w) => {
          const b = beforeOf.get(`${w.staffId}:${w.date}`);
          return {
            staffId: w.staffId,
            date: w.date,
            before: b ? { shiftTypeId: b.shiftTypeId, source: b.source, autoMonth: b.autoMonth } : null,
            after: w.shiftTypeId === null ? null : { shiftTypeId: w.shiftTypeId, source: w.source },
          };
        });
      }
      for (const w of outcome.writes) {
        if (w.shiftTypeId === null) {
          await tx.assignment.deleteMany({ where: { staffId: w.staffId, date: at(w.date) } });
        } else {
          await tx.assignment.upsert({
            where: { staffId_date: { staffId: w.staffId, date: at(w.date) } },
            update: { shiftTypeId: w.shiftTypeId, source: w.source, updatedBy: approverUserId },
            create: { staffId: w.staffId, date: at(w.date), shiftTypeId: w.shiftTypeId, source: w.source, updatedBy: approverUserId },
          });
        }
      }
    }
    const result = await finish(tx, outcome, ripple);
    return { outcome, result, range: { start: first, end: last, pad: plan.pad } };
  }, DAY_CAP_TX);
}
