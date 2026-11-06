import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { autoSchedule } from "@/lib/auto-scheduler";
import { buildAutoScheduleInput } from "@/lib/build-auto-schedule-input";
import { syncRequestApprovalsAfterCommit, visibleRequestChanges } from "@/lib/request-sync";
import { owningMonthKey, isValidDateRange } from "@/lib/auto-clear";
import { loadDayCaps, lockDayCaps, DAY_CAP_TX, DayCapRefused, refusalResponse, isTxTimeout, busyResponse } from "@/lib/day-cap-db";
import { dayCapViolations } from "@/lib/max-per-day";

type AppliedRow = { id: string; staffId: string; date: string; shiftTypeId: string; isLocked: boolean; code: string; color: string; source: string; autoMonth: string | null; autoShiftTypeId: string | null };

const dateKey = (d: Date) => d.toISOString().split("T")[0];
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export async function POST(req: NextRequest) {
  const { error } = await getSession("schedule:auto");
  if (error) return error;
  const body = await req.json();
  const { startDate, endDate } = body as { startDate: string; endDate: string };

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate required" },
      { status: 400 }
    );
  }

  const input = await buildAutoScheduleInput(startDate, endDate);
  return NextResponse.json(autoSchedule(input));
}

export async function PUT(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:auto");
  if (error) return error;
  const body = await req.json();
  const { suggestions, startDate, endDate } = body as {
    suggestions: Array<{
      staffId: string;
      date: string;
      shiftTypeId: string;
    }>;
    startDate?: string;
    endDate?: string;
  };

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return NextResponse.json({ error: "No suggestions to apply" }, { status: 400 });
  }
  if (!suggestions.every((s) => s && typeof s === "object" && isStr(s.staffId) && isStr(s.shiftTypeId) && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)))) {
    return NextResponse.json({ error: "Each suggestion needs staffId, date (YYYY-MM-DD) and shiftTypeId" }, { status: 400 });
  }

  // Per-day cap (Staffing Rules "Max"), re-checked here because the server is the
  // authority: the browser engine honours the caps itself, but its copy of the rules
  // or of the saved grid can be stale by the time the user accepts. Counted against
  // the SAVED rows on the touched dates, minus the cells the batch overwrites; a
  // suggestion onto a locked cell is skipped below, so it neither replaces nor adds.
  // Refuse the WHOLE batch (nothing written) and name the offending cell(s) so the
  // grid can show the same red-border rejection as a manual over-cap edit.
  const dates = [...new Set(suggestions.map((s) => s.date))];
  const caps = await loadDayCaps(dates);

  const shiftTypes = await prisma.shiftType.findMany();
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

  // The calendar month this run targets (the applied view), stamped on every
  // row written below so "Clear Auto" of that month can remove its overflow
  // into adjacent months by origin — see auto-clear.ts and the DELETE handler.
  // Falls back to null (legacy month-range clear) if the range is absent/invalid.
  const autoMonth =
    startDate && endDate && isValidDateRange(startDate, endDate)
      ? owningMonthKey(startDate, endDate)
      : null;

  // The cap check and every upsert run in ONE transaction under the touched dates'
  // advisory locks (src/lib/day-cap-db.ts): a manual edit on one of those dates
  // waits for the accept to commit instead of slipping in between the check and the
  // writes. The batch is now atomic — a failure part-way rolls every cell back,
  // which is what the grid assumes (a non-2xx keeps the Live sandbox, nothing saved).
  // A whole month can be hundreds of upserts, hence DAY_CAP_TX's 60 s budget.
  let outcome: { applied: AppliedRow[]; skipped: { staffId: string; date: string; reason: string }[] };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, dates);
      const onDates = await tx.assignment.findMany({
        where: { date: { in: dates.map((d) => new Date(d + "T00:00:00Z")) } },
        select: { staffId: true, date: true, shiftTypeId: true, isLocked: true },
      });
      const current = onDates.map((a) => ({ staffId: a.staffId, date: dateKey(a.date), shiftTypeId: a.shiftTypeId }));
      const lockedKeys = new Set(onDates.filter((a) => a.isLocked).map((a) => `${a.staffId}:${dateKey(a.date)}`));
      const proposed = suggestions
        .filter((s) => !lockedKeys.has(`${s.staffId}:${s.date}`))
        .map((s) => ({ staffId: s.staffId, date: s.date, shiftTypeId: s.shiftTypeId }));
      const violations = dayCapViolations(proposed, current, caps.capOf);
      if (violations.length > 0) {
        const v = violations[0];
        throw new DayCapRefused(v.shiftTypeId, v.date, { staffId: v.staffId, shiftTypeId: v.shiftTypeId, rejected: violations });
      }

      const applied: AppliedRow[] = [];
      const skipped: { staffId: string; date: string; reason: string }[] = [];
      for (const s of suggestions) {
        if (lockedKeys.has(`${s.staffId}:${s.date}`)) {
          skipped.push({ staffId: s.staffId, date: s.date, reason: "locked" });
          continue;
        }
        const result = await tx.assignment.upsert({
          where: {
            staffId_date: {
              staffId: s.staffId,
              date: new Date(s.date + "T00:00:00Z"),
            },
          },
          // Reset autoShiftTypeId: this row IS the auto value now, so any earlier
          // "was X" override capture from a prior manual edit must be cleared.
          // Record who accepted the run (updatedBy) — not shown for auto cells, but
          // keeps the audit column populated like every other write path.
          update: { shiftTypeId: s.shiftTypeId, source: "auto", autoMonth, autoShiftTypeId: null, updatedBy: userId },
          create: {
            staffId: s.staffId,
            date: new Date(s.date + "T00:00:00Z"),
            shiftTypeId: s.shiftTypeId,
            source: "auto",
            autoMonth,
            updatedBy: userId,
          },
        });
        const st = stMap.get(result.shiftTypeId);
        applied.push({
          id: result.id,
          staffId: result.staffId,
          date: result.date.toISOString().split("T")[0],
          shiftTypeId: result.shiftTypeId,
          isLocked: result.isLocked,
          code: st?.code ?? "?",
          color: st?.color ?? "#6b7280",
          // Carry provenance so the grid's post-Accept local state shows these as
          // Source: Auto (not the AssignmentData default) without a reload.
          source: result.source,
          autoMonth: result.autoMonth,
          autoShiftTypeId: result.autoShiftTypeId,
        });
      }
      return { applied, skipped };
    }, DAY_CAP_TX);
  } catch (e) {
    const refused = refusalResponse(e, caps);
    if (refused) return refused;
    throw e;
  }
  const { applied, skipped } = outcome;

  const requestChanges = await syncRequestApprovalsAfterCommit(
    "auto-schedule PUT",
    applied.map((a) => ({ staffId: a.staffId, date: a.date })),
    userId
  );

  return NextResponse.json({ applied, skipped, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}

export async function DELETE(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:auto");
  if (error) return error;
  const body = await req.json();
  const { startDate, endDate } = body as { startDate: string; endDate: string };

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
  }
  // Reject malformed/reversed ranges: Clear Auto deletes a whole origin month by
  // autoMonth with no date bound, so a bogus range must never reach owningMonthKey.
  if (!isValidDateRange(startDate, endDate)) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const shiftTypes = await prisma.shiftType.findMany();
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

  // The calendar month this clear targets, derived from the viewed range the
  // same way the apply (PUT) stamped autoMonth — so they always agree.
  const autoMonth = owningMonthKey(startDate, endDate);

  // Delete auto, unlocked rows that ORIGINATED from this month's run — wherever
  // they landed, so the run's overflow into adjacent months goes too, while a
  // different month's run (stamped a different autoMonth) is left intact. Legacy
  // rows predate autoMonth (null), so they fall back to the original
  // month-range clear by date.
  const clearWhere = {
    source: "auto",
    isLocked: false,
    OR: [
      { autoMonth },
      {
        autoMonth: null,
        date: {
          gte: new Date(startDate + "T00:00:00Z"),
          lte: new Date(endDate + "T00:00:00Z"),
        },
      },
    ],
  };
  // Card #70: Clear Auto has no date bound (it follows autoMonth), so find the dates its
  // rows sit on, lock exactly those dates FIRST in one transaction, then re-read and delete
  // only rows on locked dates. A row that lands on another date after the pre-read was made
  // after this clear was asked for, and is left alone.
  const preDates = (await prisma.assignment.findMany({ where: clearWhere, select: { date: true } }))
    .map((a) => a.date.toISOString().split("T")[0]);
  const lockedDates = [...new Set(preDates)];
  let toDelete: Awaited<ReturnType<typeof prisma.assignment.findMany>> = [];
  try {
    toDelete = lockedDates.length === 0 ? [] : await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, lockedDates);
      const rows = await tx.assignment.findMany({
        where: { AND: [clearWhere, { date: { in: lockedDates.map((d) => new Date(d + "T00:00:00Z")) } }] },
      });
      await tx.assignment.deleteMany({ where: { id: { in: rows.map((a) => a.id) } } });
      return rows;
    }, DAY_CAP_TX);
  } catch (e) {
    if (isTxTimeout(e)) return busyResponse(); // waited out behind another writer: nothing was cleared
    throw e;
  }

  const removed = toDelete.map((a) => {
    const st = stMap.get(a.shiftTypeId);
    return {
      id: a.id,
      staffId: a.staffId,
      date: a.date.toISOString().split("T")[0],
      shiftTypeId: a.shiftTypeId,
      isLocked: a.isLocked,
      code: st?.code ?? "?",
      color: st?.color ?? "#6b7280",
    };
  });

  const requestChanges = await syncRequestApprovalsAfterCommit(
    "auto-schedule DELETE",
    removed.map((a) => ({ staffId: a.staffId, date: a.date })),
    userId
  );

  return NextResponse.json({ removed, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
