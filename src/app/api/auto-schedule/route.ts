import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { autoSchedule } from "@/lib/auto-scheduler";
import { buildAutoScheduleInput } from "@/lib/build-auto-schedule-input";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";
import { owningMonthKey, isValidDateRange } from "@/lib/auto-clear";
import { loadDayCaps } from "@/lib/day-cap-db";
import { dayCapViolations } from "@/lib/max-per-day";

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
  const onDates = await prisma.assignment.findMany({
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
    return caps.dayFull(v.shiftTypeId, v.date, { staffId: v.staffId, shiftTypeId: v.shiftTypeId, rejected: violations });
  }

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

  const applied = [];
  const skipped = [];
  for (const s of suggestions) {
    const existing = await prisma.assignment.findUnique({
      where: {
        staffId_date: {
          staffId: s.staffId,
          date: new Date(s.date + "T00:00:00Z"),
        },
      },
    });
    if (existing?.isLocked) {
      skipped.push({ staffId: s.staffId, date: s.date, reason: "locked" });
      continue;
    }
    const result = await prisma.assignment.upsert({
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

  const requestChanges = await syncRequestApprovals(
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
  const toDelete = await prisma.assignment.findMany({
    where: {
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
    },
  });

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

  await prisma.assignment.deleteMany({
    where: { id: { in: toDelete.map((a) => a.id) } },
  });

  const requestChanges = await syncRequestApprovals(
    removed.map((a) => ({ staffId: a.staffId, date: a.date })),
    userId
  );

  return NextResponse.json({ removed, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
