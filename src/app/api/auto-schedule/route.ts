import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { autoSchedule } from "@/lib/auto-scheduler";
import { buildAutoScheduleInput } from "@/lib/build-auto-schedule-input";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";

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
  const { suggestions } = body as {
    suggestions: Array<{
      staffId: string;
      date: string;
      shiftTypeId: string;
    }>;
  };

  if (!suggestions?.length) {
    return NextResponse.json({ error: "No suggestions to apply" }, { status: 400 });
  }

  const shiftTypes = await prisma.shiftType.findMany();
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

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
      update: { shiftTypeId: s.shiftTypeId, source: "auto" },
      create: {
        staffId: s.staffId,
        date: new Date(s.date + "T00:00:00Z"),
        shiftTypeId: s.shiftTypeId,
        source: "auto",
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

  const shiftTypes = await prisma.shiftType.findMany();
  const stMap = new Map(shiftTypes.map((st) => [st.id, st]));

  const toDelete = await prisma.assignment.findMany({
    where: {
      source: "auto",
      isLocked: false,
      date: {
        gte: new Date(startDate + "T00:00:00Z"),
        lte: new Date(endDate + "T00:00:00Z"),
      },
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
