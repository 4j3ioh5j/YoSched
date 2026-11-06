// Card #70: taking an approval back — and, on an explicit Undo, putting its ripple back.
//
// Every un-approval (decline / withdraw / reset to pending) releases the request's own placed
// shift under the day locks (lock → re-read → decide → write, like every other assignment
// writer). An Undo (`undoApproval: true`) of an approval that re-arranged other staff also
// restores those cells, from the inverse the approval stored (`approvalRipple`), in the SAME
// transaction and ALL OR NOTHING:
//   1. the padded day locks over the request's days and every ripple day, FIRST;
//   2. the request re-read under them: still approved with the same stored ripple, or the
//      Undo is stale (RippleStale → 409 "reload");
//   3. the status change (`setStatus`), which also clears approvalRipple;
//   4. the compare-and-set: every cell the approval wrote — the requester's own included —
//      still holds exactly what it wrote (shift AND source, unlocked; still empty where it
//      deleted). A hand edit since, even a re-paste of the same shift, means "leave it";
//   5. the complete proposed grid judged by the approval's own hard-rule verifier (caps,
//      eligibility, availability, follow rules, targets, other approvals);
//   6. only then every cell put back with its original provenance (source, autoMonth) — the
//      requester's covered cells included, so a later approval's inverse finds what it wrote.
// When 4 or 5 says no, nothing is restored, the plain release runs instead (`release`: the
// request's own placed shift, as every un-approval does), the status change still commits,
// and the reason comes back in plain words. A batch Undo replays these newest-first, in the
// order the changes happened (schedule-grid.tsx), so each inverse meets the grid it left.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { DAY_CAP_TX, lockDayCaps } from "@/lib/day-cap-db";
import { planLocks, lockAndLoad, lockPlanDays } from "@/lib/request-approval-resolve";
import { dayLabel, rippleChangedCell, verifyRippleRestore, type RippleCell } from "@/lib/request-approval-outcome";

const at = (date: string) => new Date(date + "T00:00:00Z");
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** The approval changed since the client's Undo was recorded: nothing was written. */
export class RippleStale extends Error {
  constructor() {
    super("ripple-stale");
    this.name = "RippleStale";
  }
}

export type RippleRestore = { restored: boolean; reason: string | null; cells: { staffId: string; date: string }[] };

export async function unapproveUnderLocks<T>(opts: {
  requestId: string;
  staffId: string;
  coveredDates: readonly string[];
  /** The inverse to restore (parsed from the row read before the transaction), or null for a plain un-approval. */
  ripple: RippleCell[] | null;
  /** The raw stored value it was parsed from, compared under the locks. */
  storedRipple: unknown;
  userId: string | null;
  /** Pull back the request's own placed shift (the plain un-approval's write). */
  release: (tx: Prisma.TransactionClient) => Promise<void>;
  /** The status change. Must clear approvalRipple. */
  setStatus: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<{ updated: T; ripple: RippleRestore | null }> {
  const { requestId, staffId, coveredDates, ripple, storedRipple, userId, release, setStatus } = opts;

  if (!ripple || ripple.length === 0) {
    const updated = await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, coveredDates);
      await release(tx);
      return setStatus(tx);
    }, DAY_CAP_TX);
    return { updated, ripple: null };
  }

  const dates = [...coveredDates, ...ripple.map((c) => c.date)].sort();
  const start = dates[0];
  const end = dates[dates.length - 1];
  const plan = await planLocks(start, end);
  const cells = ripple.map((c) => ({ staffId: c.staffId, date: c.date }));

  return prisma.$transaction(async (tx) => {
    // 1. locks first: the padded range covers every covered and ripple day
    await lockPlanDays(tx, plan);

    // 2. the Undo must be about the approval that is still there
    const row = await tx.scheduleRequest.findUnique({ where: { id: requestId }, select: { status: true, approvalRipple: true } });
    if (!row || row.status !== "approved" || JSON.stringify(row.approvalRipple) !== JSON.stringify(storedRipple)) throw new RippleStale();

    // 3. the status change
    const updated = await setStatus(tx);
    const refuse = async (reason: string) => {
      await release(tx);
      return { updated, ripple: { restored: false, reason, cells } };
    };

    // 4. compare-and-set against the grid as the approval left it
    const rows = await tx.assignment.findMany({
      where: { OR: cells.map((c) => ({ staffId: c.staffId, date: at(c.date) })) },
      select: { staffId: true, date: true, shiftTypeId: true, source: true, isLocked: true },
    });
    const current = new Map(rows.map((r) => [`${r.staffId}:${ymd(r.date)}`, r] as const));
    const { input, context } = await lockAndLoad(tx, start, end, plan, { locked: true });
    const initialsOf = (id: string) => input.staff.find((s) => s.id === id)?.initials ?? "a staff member";
    const changed = rippleChangedCell(ripple, current);
    if (changed) return refuse(`${initialsOf(changed.staffId)}'s ${dayLabel(changed.date)} was changed after the approval, so the other staff were left as they are`);

    // 5. the whole proposed grid, by the approval's own rules
    const why = verifyRippleRestore(input, context, ripple, { requestId, staffId, dates: coveredDates });
    if (why) return refuse(`the other staff were left as they are: putting them back would break a rule (${why})`);

    // 6. put every cell back, provenance included
    for (const c of ripple) {
      if (c.before === null) {
        await tx.assignment.deleteMany({ where: { staffId: c.staffId, date: at(c.date), isLocked: false } });
      } else {
        await tx.assignment.upsert({
          where: { staffId_date: { staffId: c.staffId, date: at(c.date) } },
          update: { shiftTypeId: c.before.shiftTypeId, source: c.before.source, autoMonth: c.before.autoMonth, isLocked: false, updatedBy: userId },
          create: { staffId: c.staffId, date: at(c.date), shiftTypeId: c.before.shiftTypeId, source: c.before.source, autoMonth: c.before.autoMonth, updatedBy: userId },
        });
      }
    }
    return { updated, ripple: { restored: true, reason: null, cells } };
  }, DAY_CAP_TX);
}
