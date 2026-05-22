import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";

function formatAssignment(a: { id: string; providerId: string; shiftTypeId: string; isLocked: boolean; shiftType: { code: string; color: string | null } }, date: string) {
  return {
    id: a.id,
    providerId: a.providerId,
    date,
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    code: a.shiftType.code,
    color: a.shiftType.color ?? "#6b7280",
  };
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("manager");
  if (error) return error;
  const { providerId, date, shiftTypeId } = await req.json();

  if (!providerId || !date || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const existing = await prisma.assignment.findUnique({
    where: { providerId_date: { providerId, date: new Date(date + "T00:00:00Z") } },
  });
  if (existing?.isLocked) {
    return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
  }

  const assignment = await prisma.assignment.upsert({
    where: {
      providerId_date: { providerId, date: new Date(date + "T00:00:00Z") },
    },
    update: { shiftTypeId, source: "manual" },
    create: {
      providerId,
      date: new Date(date + "T00:00:00Z"),
      shiftTypeId,
      source: "manual",
    },
    include: { shiftType: true },
  });

  return NextResponse.json(formatAssignment(assignment, date));
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth("manager");
  if (error) return error;
  const { action, from, to } = await req.json();

  if (action === "swap" && from && to) {
    const fromDate = new Date(from.date + "T00:00:00Z");
    const toDate = new Date(to.date + "T00:00:00Z");

    const [fromAssignment, toAssignment] = await Promise.all([
      prisma.assignment.findUnique({
        where: { providerId_date: { providerId: from.providerId, date: fromDate } },
      }),
      prisma.assignment.findUnique({
        where: { providerId_date: { providerId: to.providerId, date: toDate } },
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
      // Swap: move both
      await Promise.all([
        prisma.assignment.delete({ where: { id: fromAssignment.id } }),
        prisma.assignment.delete({ where: { id: toAssignment.id } }),
      ]);
      const [newFrom, newTo] = await Promise.all([
        prisma.assignment.create({
          data: {
            providerId: to.providerId,
            date: toDate,
            shiftTypeId: fromAssignment.shiftTypeId,
            source: "manual",
          },
          include: { shiftType: true },
        }),
        prisma.assignment.create({
          data: {
            providerId: from.providerId,
            date: fromDate,
            shiftTypeId: toAssignment.shiftTypeId,
            source: "manual",
          },
          include: { shiftType: true },
        }),
      ]);
      results.moved = formatAssignment(newFrom, to.date);
      results.swapped = formatAssignment(newTo, from.date);
    } else {
      // Move: delete source, create at target
      await prisma.assignment.delete({ where: { id: fromAssignment.id } });
      const newAssignment = await prisma.assignment.create({
        data: {
          providerId: to.providerId,
          date: toDate,
          shiftTypeId: fromAssignment.shiftTypeId,
          source: "manual",
        },
        include: { shiftType: true },
      });
      results.moved = formatAssignment(newAssignment, to.date);
      results.cleared = { providerId: from.providerId, date: from.date };
    }

    return NextResponse.json(results);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth("manager");
  if (error) return error;
  const { providerId, date } = await req.json();

  if (!providerId || !date) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const existing = await prisma.assignment.findUnique({
    where: { providerId_date: { providerId, date: new Date(date + "T00:00:00Z") } },
  });
  if (existing?.isLocked) {
    return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
  }

  await prisma.assignment.deleteMany({
    where: {
      providerId,
      date: new Date(date + "T00:00:00Z"),
    },
  });

  return NextResponse.json({ ok: true });
}
