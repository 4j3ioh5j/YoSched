import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { buildSelfRequestInput, canWithdrawOwnRequest } from "@/lib/schedule-requests";
import { NextRequest, NextResponse } from "next/server";
import type { ScheduleRequest } from "@/generated/prisma/client";

// Provider self-service requests. Every handler forces the row to the caller's
// linked provider — a provider can only see and act on their OWN requests.

function serialize(r: ScheduleRequest) {
  return {
    id: r.id,
    providerId: r.providerId,
    startDate: r.startDate.toISOString().split("T")[0],
    endDate: r.endDate.toISOString().split("T")[0],
    kind: r.kind,
    shiftTypeIds: r.shiftTypeIds,
    leaveShiftTypeId: r.leaveShiftTypeId,
    strength: r.strength,
    status: r.status,
    source: r.source,
    receivedAt: r.receivedAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    notes: r.notes,
  };
}

function toDate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

// 403 when the login has requests:self but isn't linked to a provider yet.
function notLinked() {
  return NextResponse.json({ error: "Your login isn't linked to a provider yet — ask an administrator." }, { status: 403 });
}

// GET — the caller's own requests (every status), newest first.
export async function GET() {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) return notLinked();

  const requests = await prisma.scheduleRequest.findMany({
    where: { providerId: result.providerId },
    orderBy: { receivedAt: "desc" },
  });
  return NextResponse.json(requests.map(serialize));
}

// POST — create a request for yourself (forced source=provider, status pending).
export async function POST(req: NextRequest) {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) return notLinked();

  const parsed = buildSelfRequestInput(await req.json(), result.providerId);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const v = parsed.value;

  const created = await prisma.scheduleRequest.create({
    data: {
      providerId: v.providerId,
      startDate: toDate(v.startDate),
      endDate: toDate(v.endDate),
      kind: v.kind,
      shiftTypeIds: v.shiftTypeIds,
      leaveShiftTypeId: v.leaveShiftTypeId,
      strength: v.strength,
      source: v.source,
      notes: v.notes,
    },
  });
  return NextResponse.json(serialize(created), { status: 201 });
}

// DELETE — withdraw one of your own still-pending requests (kept as an audit row).
export async function DELETE(req: NextRequest) {
  const result = await getSession("requests:self");
  if (result.error) return result.error;
  if (!result.providerId) return notLinked();

  const { id } = await req.json();
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing request id" }, { status: 400 });
  }

  const existing = await prisma.scheduleRequest.findUnique({
    where: { id },
    select: { providerId: true, status: true },
  });
  if (!canWithdrawOwnRequest(existing, result.providerId)) {
    return NextResponse.json({ error: "You can only withdraw your own pending requests" }, { status: 403 });
  }

  const updated = await prisma.scheduleRequest.update({
    where: { id },
    data: { status: "withdrawn" },
  });
  return NextResponse.json(serialize(updated));
}
