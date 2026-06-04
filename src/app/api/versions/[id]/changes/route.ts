import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { type AssignmentSnapshot, diffSnapshots, summarizeChanges } from "@/lib/versions";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/versions/[id]/changes — the changes that this version introduced
// relative to the previous version (the next-lower versionNumber in the same
// month). The first version of a month is diffed against an empty schedule, so
// every assignment shows as "added". Returns ID-based changes; the client
// resolves provider initials and shift codes/colors from data it already holds.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { error } = await getSession("schedule:view");
  if (error) return error;
  const { id } = await params;

  const target = await prisma.scheduleVersion.findUnique({
    where: { id },
    select: { year: true, month: true, versionNumber: true, snapshot: true },
  });
  if (!target) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const previous = await prisma.scheduleVersion.findFirst({
    where: { year: target.year, month: target.month, versionNumber: { lt: target.versionNumber } },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, snapshot: true },
  });

  const prevSnap = (previous?.snapshot as unknown as AssignmentSnapshot[]) ?? [];
  const nextSnap = target.snapshot as unknown as AssignmentSnapshot[];
  const changes = diffSnapshots(prevSnap, nextSnap);

  return NextResponse.json({
    previousVersionNumber: previous?.versionNumber ?? null,
    summary: summarizeChanges(changes),
    changes,
  });
}
