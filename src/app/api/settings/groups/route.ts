import { prisma } from "@/lib/prisma";
import { getSession, type Permission } from "@/lib/auth-guard";
import { PERMISSION_KEYS } from "@/lib/permission-catalog";
import { assertUsersAdminSurvives, AdminGuardError } from "@/lib/user-lifecycle";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const { error } = await getSession("groups:view");
  if (error) return error;

  const groups = await prisma.group.findMany({
    orderBy: { level: "desc" },
    include: { _count: { select: { users: true } } },
  });
  return NextResponse.json(groups);
}

export async function POST(req: NextRequest) {
  const result = await getSession("groups:edit");
  if (result.error) return result.error;

  const { name, permissions, level } = await req.json();
  if (!name || !Array.isArray(permissions)) {
    return NextResponse.json({ error: "Name and permissions required" }, { status: 400 });
  }

  const groupLevel = typeof level === "number" ? level : 0;
  if (groupLevel >= result.groupLevel) {
    return NextResponse.json({ error: "Cannot create a group at or above your level" }, { status: 403 });
  }
  if (groupLevel < 0 || groupLevel > 1) {
    return NextResponse.json({ error: "Custom group level must be 0 or 1" }, { status: 400 });
  }

  const invalid = permissions.filter((p: string) => !PERMISSION_KEYS.includes(p as Permission));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Invalid permissions: ${invalid.join(", ")}` }, { status: 400 });
  }

  const group = await prisma.group.create({
    data: { name, permissions, level: groupLevel, isSystem: false, permissionsLocked: false },
    include: { _count: { select: { users: true } } },
  });
  return NextResponse.json(group);
}

export async function PUT(req: NextRequest) {
  const result = await getSession("groups:edit");
  if (result.error) return result.error;

  const { id, name, permissions } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  if (group.level >= result.groupLevel) {
    return NextResponse.json({ error: "Cannot edit a group at or above your level" }, { status: 403 });
  }
  if (group.permissionsLocked) {
    return NextResponse.json({ error: "This group's permissions cannot be modified" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (name && !group.isSystem) data.name = name;
  if (Array.isArray(permissions)) {
    const invalid = permissions.filter((p: string) => !PERMISSION_KEYS.includes(p as Permission));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Invalid permissions: ${invalid.join(", ")}` }, { status: 400 });
    }
    data.permissions = permissions;

    // Admin-safety: editing this group's permissions must not strip users:edit from
    // the last administrator (members of this group resolve through the new array).
    try {
      await assertUsersAdminSurvives({ kind: "updateGroupPermissions", groupId: id, permissions });
    } catch (e) {
      if (e instanceof AdminGuardError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
  }

  const updated = await prisma.group.update({
    where: { id },
    data,
    include: { _count: { select: { users: true } } },
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const result = await getSession("groups:edit");
  if (result.error) return result.error;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const group = await prisma.group.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  if (group.isSystem) {
    return NextResponse.json({ error: "Cannot delete a system group" }, { status: 403 });
  }
  if (group.level >= result.groupLevel) {
    return NextResponse.json({ error: "Cannot delete a group at or above your level" }, { status: 403 });
  }
  if (group._count.users > 0) {
    return NextResponse.json({ error: "Cannot delete a group with active users" }, { status: 400 });
  }

  await prisma.group.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
