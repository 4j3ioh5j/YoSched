import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride, resolveUpdaterNames } from "@/lib/assignment-attribution";
import { dayCapViolations } from "@/lib/max-per-day";
import { NextRequest, NextResponse } from "next/server";

// updatedByName is the resolved display NAME of the acting user (this route is
// schedule:edit-only, so the caller may always see it); drives the tooltip's
// "changed by X". Never the userId/email.
function formatAssignment(a: { id: string; staffId: string; shiftTypeId: string; isLocked: boolean; source: string; autoMonth: string | null; autoShiftTypeId: string | null; updatedAt: Date; shiftType: { code: string; color: string | null } }, date: string, updatedByName: string | null = null) {
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

  const existing = await prisma.assignment.findUnique({
    where: { staffId_date: { staffId, date: new Date(date + "T00:00:00Z") } },
  });
  if (existing?.isLocked) {
    return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
  }

  // Per-day cap (maxPerDay): authoritatively refuse a write that would place more
  // than the allowed number of this shift on the date (e.g. a second ORC/ORL/ICU).
  // Defense-in-depth behind the client guard — also stops concurrent-editor races.
  // Re-assigning the SAME shift to this same cell is fine (count excludes self).
  const st = await prisma.shiftType.findUnique({ where: { id: shiftTypeId }, select: { code: true, maxPerDay: true } });
  if (st?.maxPerDay != null && (existing?.shiftTypeId !== shiftTypeId)) {
    const sameDay = await prisma.assignment.count({
      where: { date: new Date(date + "T00:00:00Z"), shiftTypeId, staffId: { not: staffId } },
    });
    if (sameDay >= st.maxPerDay) {
      return NextResponse.json(
        { error: `Only ${st.maxPerDay} ${st.code} allowed per day`, reason: "day-full", code: st.code, maxPerDay: st.maxPerDay },
        { status: 409 },
      );
    }
  }

  // Capture the value the Auto-schedule run placed here so the tooltip can show
  // "Auto → Manual (was X)". See resolveAutoOverride for the rules.
  const autoShiftTypeId = resolveAutoOverride(existing, shiftTypeId);

  const assignment = await prisma.assignment.upsert({
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

  const requestChanges = await syncRequestApprovals([{ staffId, date }], userId);
  const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;

  return NextResponse.json({ ...formatAssignment(assignment, date, actorName), requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
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

    // Per-day cap: a move/swap relocates the dragged shift to `to` (and, on a swap,
    // the displaced shift to `from`). Refuse if either landing would exceed that
    // shift's maxPerDay on its date. The swap rewrites EXACTLY two cells — the
    // source (from) and the destination (to) — so only THOSE two cells are excluded
    // from the count (not every assignment those staff hold on the landing dates).
    // dayCapViolations excludes the landing keys; we additionally drop the vacated
    // source cell so a pure move on the same date isn't counted against itself.
    const landings = [{ staffId: to.staffId, date: to.date, shiftTypeId: fromAssignment.shiftTypeId }];
    if (toAssignment) landings.push({ staffId: from.staffId, date: from.date, shiftTypeId: toAssignment.shiftTypeId });
    const capIds = [...new Set(landings.map((l) => l.shiftTypeId))];
    const caps = new Map(
      (await prisma.shiftType.findMany({ where: { id: { in: capIds } }, select: { id: true, code: true, maxPerDay: true } }))
        .map((s) => [s.id, s]),
    );
    const cappedLandingIds = capIds.filter((id) => caps.get(id)?.maxPerDay != null);
    if (cappedLandingIds.length > 0) {
      const dates = [...new Set([from.date, to.date])].map((d) => new Date(d + "T00:00:00Z"));
      const rows = await prisma.assignment.findMany({
        where: { date: { in: dates }, shiftTypeId: { in: cappedLandingIds } },
        select: { staffId: true, date: true, shiftTypeId: true },
      });
      const rewritten = new Set([`${from.staffId}:${from.date}`, `${to.staffId}:${to.date}`]);
      const current = rows
        .map((r) => ({ staffId: r.staffId, date: r.date.toISOString().split("T")[0], shiftTypeId: r.shiftTypeId }))
        .filter((r) => !rewritten.has(`${r.staffId}:${r.date}`));
      const violations = dayCapViolations(landings, current, (id) => caps.get(id)?.maxPerDay ?? null);
      if (violations.length > 0) {
        const cap = caps.get(violations[0].shiftTypeId)!;
        return NextResponse.json(
          { error: `Only ${cap.maxPerDay} ${cap.code} allowed per day`, reason: "day-full", code: cap.code, maxPerDay: cap.maxPerDay },
          { status: 409 },
        );
      }
    }

    const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;
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
      });
      results.moved = formatAssignment(newFrom, to.date, actorName);
      results.swapped = formatAssignment(newTo, from.date, actorName);
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
            updatedBy: userId,
          },
          include: { shiftType: true },
        });
      });
      results.moved = formatAssignment(newAssignment, to.date, actorName);
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
