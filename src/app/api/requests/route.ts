import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validateRequestInput } from "@/lib/schedule-requests";
import { NextRequest, NextResponse } from "next/server";
import type { ScheduleRequest } from "@/generated/prisma/client";

function serialize(r: ScheduleRequest) {
  return {
    id: r.id,
    staffId: r.staffId,
    startDate: r.startDate.toISOString().split("T")[0],
    endDate: r.endDate.toISOString().split("T")[0],
    kind: r.kind,
    shiftTypeIds: r.shiftTypeIds,
    leaveShiftTypeId: r.leaveShiftTypeId,
    strength: r.strength,
    status: r.status,
    autoApproved: r.autoApproved,
    source: r.source,
    receivedAt: r.receivedAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    notes: r.notes,
  };
}

function toDate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

// GET — all schedule requests (the grid filters to the visible month client-side).
export async function GET() {
  const result = await getSession("requests:view");
  if (result.error) return result.error;

  const requests = await prisma.scheduleRequest.findMany({
    orderBy: { receivedAt: "desc" },
  });
  return NextResponse.json(requests.map(serialize));
}

// POST — create a new request (always starts pending; approval is a separate step).
export async function POST(req: NextRequest) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;

  const parsed = validateRequestInput(await req.json());
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const v = parsed.value;

  const created = await prisma.scheduleRequest.create({
    data: {
      staffId: v.staffId,
      startDate: toDate(v.startDate),
      endDate: toDate(v.endDate),
      kind: v.kind,
      shiftTypeIds: v.shiftTypeIds,
      leaveShiftTypeId: v.leaveShiftTypeId,
      strength: v.strength,
      source: v.source,
      notes: v.notes,
      // status defaults to "pending" in the schema — approval is explicit.
    },
  });
  return NextResponse.json(serialize(created), { status: 201 });
}
