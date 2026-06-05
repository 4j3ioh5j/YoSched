import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// Allowed status transitions. "approved" stamps approver + time; the terminal
// states (declined/withdrawn/fulfilled) just record the outcome.
const STATUSES = ["pending", "approved", "declined", "withdrawn", "fulfilled"] as const;

// PATCH — change a request's status (the approval action). Requires schedule:edit.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id } = await params;

  const existing = await prisma.scheduleRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const body = await req.json();
  const status: string = body?.status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  }

  const updated = await prisma.scheduleRequest.update({
    where: { id },
    data: {
      status,
      // Stamp the approval; clear the stamp if it moves back off "approved".
      approvedAt: status === "approved" ? new Date() : null,
      approvedBy: status === "approved" ? result.userId : null,
    },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : null,
  });
}

// DELETE — remove a request entirely. Requires schedule:edit.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const result = await getSession("schedule:edit");
  if (result.error) return result.error;
  const { id } = await params;

  const existing = await prisma.scheduleRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  await prisma.scheduleRequest.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
