import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { type AssignmentSnapshot, monthDateRange, hashSnapshot, nextVersionNumber } from "@/lib/versions";

// Metadata returned for listing — excludes the (potentially large) snapshot blob.
const LIST_SELECT = {
  id: true,
  year: true,
  month: true,
  versionNumber: true,
  comment: true,
  isCurrent: true,
  isAutoBackup: true,
  snapshotHash: true,
  createdAt: true,
} as const;

function parseYearMonth(req: NextRequest): { year: number; month: number } | null {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) return null;
  return { year, month };
}

/** Build the snapshot of a calendar month's current assignments. */
async function snapshotMonth(year: number, month: number): Promise<AssignmentSnapshot[]> {
  const { start, end } = monthDateRange(year, month);
  const rows = await prisma.assignment.findMany({
    where: { date: { gte: start, lt: end } },
    select: { staffId: true, date: true, shiftTypeId: true, isLocked: true, source: true, notes: true },
  });
  return rows.map((a) => ({
    staffId: a.staffId,
    date: a.date.toISOString().split("T")[0],
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    source: a.source,
    notes: a.notes,
  }));
}

// GET /api/versions?year=&month= — list versions for a calendar month, newest first.
export async function GET(req: NextRequest) {
  const { error } = await getSession("schedule:view");
  if (error) return error;

  const ym = parseYearMonth(req);
  if (!ym) return NextResponse.json({ error: "Invalid year/month" }, { status: 400 });

  const versions = await prisma.scheduleVersion.findMany({
    where: { year: ym.year, month: ym.month },
    select: LIST_SELECT,
    orderBy: { versionNumber: "desc" },
  });
  return NextResponse.json({ versions });
}

// POST /api/versions { year, month, comment? } — snapshot the current month as a
// new version and mark it current.
export async function POST(req: NextRequest) {
  const { error } = await getSession("schedule:edit");
  if (error) return error;

  const body = await req.json().catch(() => null);
  const year = Number(body?.year);
  const month = Number(body?.month);
  const comment: string | null = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
    return NextResponse.json({ error: "Invalid year/month" }, { status: 400 });
  }

  const snapshot = await snapshotMonth(year, month);
  const snapshotHash = hashSnapshot(snapshot);

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.scheduleVersion.findMany({
      where: { year, month },
      select: { versionNumber: true },
    });
    const versionNumber = nextVersionNumber(existing.map((v) => v.versionNumber));
    await tx.scheduleVersion.updateMany({ where: { year, month, isCurrent: true }, data: { isCurrent: false } });
    return tx.scheduleVersion.create({
      data: { year, month, versionNumber, comment, snapshot, snapshotHash, isCurrent: true },
      select: LIST_SELECT,
    });
  });

  return NextResponse.json({ version: created });
}
