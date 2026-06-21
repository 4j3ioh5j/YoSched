import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride } from "@/lib/assignment-attribution";
import { NextRequest, NextResponse } from "next/server";

function formatAssignment(a: { id: string; staffId: string; shiftTypeId: string; isLocked: boolean; source: string; autoMonth: string | null; autoShiftTypeId: string | null; shiftType: { code: string; color: string | null } }, date: string) {
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
  };
}

export async function PUT(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { staffId, date, shiftTypeId } = await req.json();

  if (!staffId || !date || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const existing = await prisma.assignment.findUnique({
    where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
  });
  if (existing?.isLocked) {
    return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
  }

  // Capture the value the Auto-schedule run placed here so the tooltip can show
  // "Auto → Manual (was X)". See resolveAutoOverride for the rules.
  const autoShiftTypeId = resolveAutoOverride(existing, shiftTypeId);

  const assignment = await prisma.assignment.upsert({
    where: {
      staffId_date: { staffId, date: new Date(date + "T00:00:00Z") },
    },
    update: { shiftTypeId, source: "manual", autoShiftTypeId },
    create: {
      staffId,
      date: new Date(date + "T00:00:00Z"),
      shiftTypeId,
      source: "manual",
    },
    include: { shiftType: true },
  });

  const requestChanges = await syncRequestApprovals([{ staffId, date }], userId);

  return NextResponse.json({ ...formatAssignment(assignment, date), requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}

export async function POST(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;
  const { action, from, to } = await req.json();

  if (action === "swap" && from && to) {
    const fromDate = new Date(from.date + "T00:00:00Z");
    const toDate = new Date(to.date + "T00:00:00Z");

    const [fromAssignment, toAssignment] = await Promise.all([
      prisma.assignment.findUnique({
        where: { staffId_date: { staffId: from.staffId, date: fromDate } },
      }),
      prisma.assignment.findUnique({
        where: { staffId_date: { staffId: to.staffId, date: toDate } },
      }),
    ]);

    if (!fromAssignment) {
      return NextResponse.json({ error: "Source assignment not found" }, { status: 404 });
    }

    if (fromAssignment.isLocked || toAssignment?.isLocked) {
      return NextResponse.json({ error: "Cannot move locked assignments" }, { status: 400 });
    }

    const results: Record<string, unknown> = {};

    if (toAssignment) {
      const [newFrom, newTo] = await prisma.$transaction(async (tx) => {
        await tx.assignment.delete({ where: { id: fromAssignment.id } });
        await tx.assignment.delete({ where: { id: toAssignment.id } });
        // Each destination keeps the auto baseline of the occupant it displaces,
        // so the tooltip still shows "was X" for the cell whose auto value was
        // overwritten by the swap (delete+create can't "leave the column unchanged").
        return Promise.all([
          tx.assignment.create({
            data: {
              staffId: to.staffId,
              date: toDate,
              shiftTypeId: fromAssignment.shiftTypeId,
              source: "manual",
              autoShiftTypeId: resolveAutoOverride(toAssignment, fromAssignment.shiftTypeId),
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
            },
            include: { shiftType: true },
          }),
        ]);
      });
      results.moved = formatAssignment(newFrom, to.date);
      results.swapped = formatAssignment(newTo, from.date);
    } else {
      const newAssignment = await prisma.$transaction(async (tx) => {
        await tx.assignment.delete({ where: { id: fromAssignment.id } });
        return tx.assignment.create({
          data: {
            staffId: to.staffId,
            date: toDate,
            shiftTypeId: fromAssignment.shiftTypeId,
            source: "manual",
            // Destination was empty here (toAssignment is null) → no baseline → null.
            autoShiftTypeId: resolveAutoOverride(toAssignment, fromAssignment.shiftTypeId),
          },
          include: { shiftType: true },
        });
      });
      results.moved = formatAssignment(newAssignment, to.date);
      results.cleared = { staffId: from.staffId, date: from.date };
    }

    const requestChanges = await syncRequestApprovals(
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

  const existing = await prisma.assignment.findUnique({
    where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
  });
  if (existing?.isLocked) {
    return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
  }

  await prisma.assignment.deleteMany({
    where: {
      staffId,
      date: new Date(date + "T00:00:00Z"),
    },
  });

  const requestChanges = await syncRequestApprovals([{ staffId, date }], userId);

  return NextResponse.json({ ok: true, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
