import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { monthDateRange, hashSnapshot, nextVersionNumber } from "@/lib/versions";
import { snapshotMonth, VERSION_LIST_SELECT } from "@/lib/versions-db";
import { lockDayCaps, dateKeysBetween, DAY_CAP_TX, isTxTimeout, busyResponse } from "@/lib/day-cap-db";

const LIST_SELECT = VERSION_LIST_SELECT;

function parseYearMonth(req: NextRequest): { year: number; month: number } | null {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) return null;
  return { year, month };
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

  // Card #312: snapshot and number the version under the month's day locks, so a save
  // in flight is either wholly in the snapshot or waits, and this writer cannot race
  // /api/versions/ensure or a restore on the (year, month, versionNumber) key.
  const { start, end } = monthDateRange(year, month);
  try {
    const created = await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, dateKeysBetween(start, end));
      const snapshot = await snapshotMonth(tx, year, month);
      const snapshotHash = hashSnapshot(snapshot);
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
    }, DAY_CAP_TX);
    return NextResponse.json({ version: created });
  } catch (e) {
    if (isTxTimeout(e)) return busyResponse();
    throw e;
  }
}
