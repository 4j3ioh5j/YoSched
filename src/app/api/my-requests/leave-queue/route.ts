import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { summarizeLeaveQueue, isValidDateStr, type LeaveQueueRequest } from "@/lib/schedule-requests";
import { NextRequest, NextResponse } from "next/server";

// Aggregate leave-queue feedback for the staff composing a request: how many
// OTHERS are already away over [start,end] and where they'd stand. Response is
// COUNTS ONLY — never the other staff' identities.
export async function GET(req: NextRequest) {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.staffId) {
    return NextResponse.json({ error: "Not linked to a staff" }, { status: 403 });
  }

  const start = req.nextUrl.searchParams.get("start") ?? "";
  const end = req.nextUrl.searchParams.get("end") || start;
  if (!isValidDateStr(start) || !isValidDateStr(end)) {
    return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
  }
  if (start > end) {
    return NextResponse.json({ error: "start must be on or before end" }, { status: 400 });
  }
  // Cap the span so a caller can't force a giant day-by-day loop. A real leave
  // request spans days to weeks; a year is a generous ceiling.
  const MAX_SPAN_DAYS = 366;
  const spanDays = Math.round(
    (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000
  );
  if (spanDays > MAX_SPAN_DAYS) {
    return NextResponse.json({ error: `Date range too large (max ${MAX_SPAN_DAYS} days)` }, { status: 400 });
  }

  // Live "away" requests overlapping the window: legacy OFF/LEAVE, plus REQUEST_SHIFT
  // (staff now ask for time off by requesting the Off/leave shift). The pure summarizer
  // decides which REQUEST_SHIFT rows actually count via isAwayShift, so we must carry
  // shiftTypeIds. The off/leave shift-id set is fetched once and passed as the predicate.
  const [rows, awayShifts] = await Promise.all([
    prisma.scheduleRequest.findMany({
      where: {
        kind: { in: ["OFF", "LEAVE", "REQUEST_SHIFT"] },
        status: { in: ["pending", "approved"] },
        startDate: { lte: new Date(end + "T00:00:00Z") },
        endDate: { gte: new Date(start + "T00:00:00Z") },
      },
      select: { staffId: true, startDate: true, endDate: true, kind: true, shiftTypeIds: true, status: true, receivedAt: true },
    }),
    prisma.shiftType.findMany({
      where: { OR: [{ isLeave: true }, { isOffShift: true }] },
      select: { id: true },
    }),
  ]);
  const awayShiftIds = new Set(awayShifts.map((s) => s.id));

  const requests: LeaveQueueRequest[] = rows.map((r) => ({
    staffId: r.staffId,
    startDate: r.startDate.toISOString().split("T")[0],
    endDate: r.endDate.toISOString().split("T")[0],
    kind: r.kind as LeaveQueueRequest["kind"],
    shiftTypeIds: r.shiftTypeIds,
    status: r.status as LeaveQueueRequest["status"],
    receivedAt: r.receivedAt.toISOString(),
  }));

  // receivedAtIso=null: this is a not-yet-submitted request, so it queues last.
  const summary = summarizeLeaveQueue({
    requests,
    staffId: result.staffId,
    start,
    end,
    receivedAtIso: null,
    isAwayShift: (id) => awayShiftIds.has(id),
  });

  return NextResponse.json({ summary });
}
