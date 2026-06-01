import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { coerceSpec } from "@/lib/graph/spec";
import { canManageView, nextOwnerId } from "@/lib/graph/view-access";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

// PUT — update name / spec / isShared. Requires statistics:manage.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const result = await getSession("statistics:manage");
  if (result.error) return result.error;
  const { id } = await params;

  const existing = await prisma.savedGraphView.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "View not found" }, { status: 404 });
  if (!canManageView(existing, result.userId)) {
    return NextResponse.json({ error: "Cannot edit another user's private view" }, { status: 403 });
  }

  const body = await req.json();
  const data: { name?: string; spec?: object; isShared?: boolean; ownerId?: string | null } = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.name = name;
  }
  if (body?.spec !== undefined) data.spec = coerceSpec(body.spec);
  if (typeof body?.isShared === "boolean") {
    data.isShared = body.isShared;
    // A shared view becoming private must be claimed by the actor, or it would
    // become an invisible orphan (ownerId null) / private to someone else.
    const owner = nextOwnerId(existing, body.isShared, result.userId);
    if (owner !== existing.ownerId) data.ownerId = owner;
  }

  const view = await prisma.savedGraphView.update({ where: { id }, data });
  return NextResponse.json(view);
}

// DELETE — remove a saved view. Requires statistics:manage.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const result = await getSession("statistics:manage");
  if (result.error) return result.error;
  const { id } = await params;

  const existing = await prisma.savedGraphView.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "View not found" }, { status: 404 });
  if (!canManageView(existing, result.userId)) {
    return NextResponse.json({ error: "Cannot delete another user's private view" }, { status: 403 });
  }

  await prisma.savedGraphView.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
