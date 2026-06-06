import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { summarizeLeaveQueue, isValidDateStr, type LeaveQueueRequest } from "@/lib/schedule-requests";
import { NextRequest, NextResponse } from "next/server";

// Aggregate leave-queue feedback for the provider composing a request: how many
// OTHERS are already away over [start,end] and where they'd stand. Response is
// COUNTS ONLY — never the other providers' identities.
export async function GET(req: NextRequest) {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) {
    return NextResponse.json({ error: "Not linked to a provider" }, { status: 403 });
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

  // Only live OFF/LEAVE requests overlapping the window are relevant.
  const rows = await prisma.scheduleRequest.findMany({
    where: {
      kind: { in: ["OFF", "LEAVE"] },
      status: { in: ["pending", "approved"] },
      startDate: { lte: new Date(end + "T00:00:00Z") },
      endDate: { gte: new Date(start + "T00:00:00Z") },
    },
    select: { providerId: true, startDate: true, endDate: true, kind: true, status: true, receivedAt: true },
  });

  const requests: LeaveQueueRequest[] = rows.map((r) => ({
    providerId: r.providerId,
    startDate: r.startDate.toISOString().split("T")[0],
    endDate: r.endDate.toISOString().split("T")[0],
    kind: r.kind as LeaveQueueRequest["kind"],
    status: r.status as LeaveQueueRequest["status"],
    receivedAt: r.receivedAt.toISOString(),
  }));

  // receivedAtIso=null: this is a not-yet-submitted request, so it queues last.
  const summary = summarizeLeaveQueue({
    requests,
    providerId: result.providerId,
    start,
    end,
    receivedAtIso: null,
  });

  return NextResponse.json({ summary });
}
