import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovalsAfterCommit, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride, resolveUpdaterNames } from "@/lib/assignment-attribution";
import { dayCapViolations } from "@/lib/max-per-day";
import { loadDayCaps, lockDayCaps, DAY_CAP_TX, DayCapRefused, WriteRefused, refusalResponse, isTxTimeout, busyResponse } from "@/lib/day-cap-db";
import { NextRequest, NextResponse } from "next/server";

type AssignmentRow = { id: string; staffId: string; shiftTypeId: string; isLocked: boolean; source: string; autoMonth: string | null; autoShiftTypeId: string | null; updatedAt: Date; shiftType: { code: string; color: string | null } };

// updatedByName is the resolved display NAME of the acting user (this route is
// schedule:edit-only, so the caller may always see it); drives the tooltip's
// "changed by X". Never the userId/email.
function formatAssignment(a: AssignmentRow, date: string, updatedByName: string | null = null) {
  return {
    id: a.id,
    staffId: a.staffId,
    date,
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    code: a.shiftType.code,
    color: a.shiftType.color ?? "#6b7280",
    source: a.source,
    autoMonth: a.autoMonth,
    autoShiftTypeId: a.autoShiftTypeId,
    updatedByName,
    updatedAt: a.updatedAt.toISOString(),
  };
}

export async function PUT(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { staffId, date, shiftTypeId } = await req.json();

  if (!staffId || !date || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Settings (rules, holidays, shift codes) and the actor's name are read BEFORE the
  // transaction: they are not part of the race, and nothing after the commit may fail
  // in a way that reports a saved cell as an error.
  const caps = await loadDayCaps([date]);
  const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;

  let assignment;
  try {
    assignment = await prisma.$transaction(async (tx) => {
      // Lock this date first, then read: every other writer on the date waits here, so
      // the count below is the truth at the moment of the write (src/lib/day-cap-db.ts).
      await lockDayCaps(tx, [date]);
      const existing = await tx.assignment.findUnique({
        where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
      });
      if (existing?.isLocked) throw new WriteRefused({ error: "Cannot modify locked assignment" }, 400);

      // Per-day cap (Staffing Rules "Max" for this date's day): authoritatively refuse a
      // write that would place more than the allowed number of this shift on the date
      // (e.g. a second ORC/ORL/ICU). Re-assigning the SAME shift to this cell is fine.
      const cap = caps.capOf(shiftTypeId, date);
      if (cap != null && (existing?.shiftTypeId !== shiftTypeId)) {
        const sameDay = await tx.assignment.count({
          where: { date: new Date(date + "T00:00:00Z"), shiftTypeId, staffId: { not: staffId } },
        });
        if (sameDay >= cap) throw new DayCapRefused(shiftTypeId, date);
      }

      // Capture the value the Auto-schedule run placed here so the tooltip can show
      // "Auto → Manual (was X)". See resolveAutoOverride for the rules.
      const autoShiftTypeId = resolveAutoOverride(existing, shiftTypeId);

      return tx.assignment.upsert({
        where: {
          staffId_date: { staffId, date: new Date(date + "T00:00:00Z") },
        },
        update: { shiftTypeId, source: "manual", autoShiftTypeId, updatedBy: userId },
        create: {
          staffId,
          date: new Date(date + "T00:00:00Z"),
          shiftTypeId,
          source: "manual",
          updatedBy: userId,
        },
        include: { shiftType: true },
      });
    }, DAY_CAP_TX);
  } catch (e) {
    const refused = refusalResponse(e, caps);
    if (refused) return refused;
    throw e;
  }

  const requestChanges = await syncRequestApprovalsAfterCommit("assignments PUT", [{ staffId, date }], userId);

  return NextResponse.json({ ...formatAssignment(assignment, date, actorName), requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}

export async function POST(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { action, from, to } = await req.json();

  if (action === "swap" && from && to) {
    const fromDate = new Date(from.date + "T00:00:00Z");
    const toDate = new Date(to.date + "T00:00:00Z");

    const caps = await loadDayCaps([from.date, to.date]);
    const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;
    const results: Record<string, unknown> = {};

    let outcome: { moved: AssignmentRow; swapped: AssignmentRow | null };
    try {
      outcome = await prisma.$transaction(async (tx) => {
        // Both dates locked first (sorted inside), then the two cells are read under
        // the lock, so no other writer can change either date between the cap check
        // and the delete/create below.
        await lockDayCaps(tx, [from.date, to.date]);
        const [fromAssignment, toAssignment] = await Promise.all([
          tx.assignment.findUnique({
            where: { staffId_date: { staffId: from.staffId, date: fromDate } },
          }),
          tx.assignment.findUnique({
            where: { staffId_date: { staffId: to.staffId, date: toDate } },
          }),
        ]);

        if (!fromAssignment) throw new WriteRefused({ error: "Source assignment not found" }, 404);
        if (fromAssignment.isLocked || toAssignment?.isLocked) throw new WriteRefused({ error: "Cannot move locked assignments" }, 400);

        // Per-day cap: a move/swap relocates the dragged shift to `to` (and, on a swap,
        // the displaced shift to `from`). Refuse if either landing would exceed that
        // shift's per-day cap on its date. The swap rewrites EXACTLY two cells — the
        // source (from) and the destination (to) — so only THOSE two cells are excluded
        // from the count (not every assignment those staff hold on the landing dates).
        // dayCapViolations excludes the landing keys; we additionally drop the vacated
        // source cell so a pure move on the same date isn't counted against itself.
        const landings = [{ staffId: to.staffId, date: to.date, shiftTypeId: fromAssignment.shiftTypeId }];
        if (toAssignment) landings.push({ staffId: from.staffId, date: from.date, shiftTypeId: toAssignment.shiftTypeId });
        const capIds = [...new Set(landings.map((l) => l.shiftTypeId))];
        const cappedLandingIds = capIds.filter((id) => landings.some((l) => l.shiftTypeId === id && caps.capOf(id, l.date) != null));
        if (cappedLandingIds.length > 0) {
          const dates = [...new Set([from.date, to.date])].map((d) => new Date(d + "T00:00:00Z"));
          const rows = await tx.assignment.findMany({
            where: { date: { in: dates }, shiftTypeId: { in: cappedLandingIds } },
            select: { staffId: true, date: true, shiftTypeId: true },
          });
          const rewritten = new Set([`${from.staffId}:${from.date}`, `${to.staffId}:${to.date}`]);
          const current = rows
            .map((r) => ({ staffId: r.staffId, date: r.date.toISOString().split("T")[0], shiftTypeId: r.shiftTypeId }))
            .filter((r) => !rewritten.has(`${r.staffId}:${r.date}`));
          const violations = dayCapViolations(landings, current, caps.capOf);
          if (violations.length > 0) throw new DayCapRefused(violations[0].shiftTypeId, violations[0].date);
        }

        if (toAssignment) {
          await tx.assignment.delete({ where: { id: fromAssignment.id } });
          await tx.assignment.delete({ where: { id: toAssignment.id } });
          // Each destination keeps the auto baseline of the occupant it displaces,
          // so the tooltip still shows "was X" for the cell whose auto value was
          // overwritten by the swap (delete+create can't "leave the column unchanged").
          const [newFrom, newTo] = await Promise.all([
            tx.assignment.create({
              data: {
                staffId: to.staffId,
                date: toDate,
                shiftTypeId: fromAssignment.shiftTypeId,
                source: "manual",
                autoShiftTypeId: resolveAutoOverride(toAssignment, fromAssignment.shiftTypeId),
                updatedBy: userId,
              },
              include: { shiftType: true },
            }),
            tx.assignment.create({
              data: {
                staffId: from.staffId,
                date: fromDate,
                shiftTypeId: toAssignment.shiftTypeId,
                source: "manual",
                autoShiftTypeId: resolveAutoOverride(fromAssignment, toAssignment.shiftTypeId),
                updatedBy: userId,
              },
              include: { shiftType: true },
            }),
          ]);
          return { moved: newFrom, swapped: newTo };
        }

        await tx.assignment.delete({ where: { id: fromAssignment.id } });
        const newAssignment = await tx.assignment.create({
          data: {
            staffId: to.staffId,
            date: toDate,
            shiftTypeId: fromAssignment.shiftTypeId,
            source: "manual",
            // Destination was empty here (toAssignment is null) → no baseline → null.
            autoShiftTypeId: resolveAutoOverride(toAssignment, fromAssignment.shiftTypeId),
            updatedBy: userId,
          },
          include: { shiftType: true },
        });
        return { moved: newAssignment, swapped: null };
      }, DAY_CAP_TX);
    } catch (e) {
      const refused = refusalResponse(e, caps);
      if (refused) return refused;
      throw e;
    }

    results.moved = formatAssignment(outcome.moved, to.date, actorName);
    if (outcome.swapped) results.swapped = formatAssignment(outcome.swapped, from.date, actorName);
    else results.cleared = { staffId: from.staffId, date: from.date };

    const requestChanges = await syncRequestApprovalsAfterCommit(
      "assignments POST swap",
      [
        { staffId: from.staffId, date: from.date },
        { staffId: to.staffId, date: to.date },
      ],
      userId
    );
    results.requestChanges = visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null });

    return NextResponse.json(results);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { staffId, date } = await req.json();

  if (!staffId || !date) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Card #70: lock → re-read → check → delete, like every other writer of the day, so an
  // approval Undo's compare-and-set can't race a clear between its read and its write.
  try {
    await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, [date]);
      const existing = await tx.assignment.findUnique({
        where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
      });
      if (existing?.isLocked) throw new WriteRefused({ error: "Cannot delete locked assignment" }, 400);
      await tx.assignment.deleteMany({ where: { staffId, date: new Date(date + "T00:00:00Z") } });
    }, DAY_CAP_TX);
  } catch (e) {
    if (e instanceof WriteRefused) return NextResponse.json(e.body, { status: e.status });
    if (isTxTimeout(e)) return busyResponse(); // waited out behind another writer of the day
    throw e;
  }

  const requestChanges = await syncRequestApprovalsAfterCommit("assignments DELETE", [{ staffId, date }], userId);

  return NextResponse.json({ ok: true, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
