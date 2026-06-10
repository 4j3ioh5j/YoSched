import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validatePassword } from "@/lib/password";
import { normalizeStaffId, isStaffLinkConflict } from "@/lib/user-link";
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";

// Shape returned for every user row — includes the linked staff (if any).
const USER_SELECT = {
  id: true, email: true, name: true, role: true, groupId: true, staffId: true, isActive: true, totpEnabled: true, createdAt: true,
  group: { select: { name: true, level: true } },
  staff: { select: { id: true, name: true, initials: true } },
} as const;

// True if `wantedStaffId` is already linked to a user other than `editingUserId`.
async function staffLinkConflict(wantedStaffId: string | null, editingUserId: string | null): Promise<boolean> {
  if (!wantedStaffId) return false;
  const owner = await prisma.user.findUnique({ where: { staffId: wantedStaffId }, select: { id: true } });
  return isStaffLinkConflict({ wantedStaffId, currentOwnerUserId: owner?.id ?? null, editingUserId });
}

export async function GET() {
  const { error } = await getSession("users:view");
  if (error) return error;

  const users = await prisma.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { email, name, password, role, groupId, staffId } = await req.json();
  if (!email || !name || !password) {
    return NextResponse.json({ error: "Email, name, and password required" }, { status: 400 });
  }

  const linkStaffId = normalizeStaffId(staffId);
  if (await staffLinkConflict(linkStaffId, null)) {
    return NextResponse.json({ error: "That staff is already linked to another login" }, { status: 409 });
  }

  const { valid, errors } = validatePassword(password);
  if (!valid) {
    return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
  }

  if (groupId) {
    const targetGroup = await prisma.group.findUnique({ where: { id: groupId }, select: { level: true } });
    if (!targetGroup || targetGroup.level >= result.groupLevel) {
      return NextResponse.json({ error: "Cannot assign user to a group at or above your level" }, { status: 403 });
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const defaultGroup = groupId ? undefined : await prisma.group.findUnique({ where: { name: "Staff" }, select: { id: true } });
  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, role: role || "viewer", groupId: groupId || defaultGroup?.id, staffId: linkStaffId },
    select: USER_SELECT,
  });

  return NextResponse.json(user);
}

export async function PUT(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { id, email, name, password, role, groupId, isActive, staffId } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { group: { select: { level: true } } },
  });
  if (targetUser?.group && targetUser.group.level >= result.groupLevel) {
    return NextResponse.json({ error: "Cannot edit a user at or above your group level" }, { status: 403 });
  }

  if (groupId) {
    const targetGroup = await prisma.group.findUnique({ where: { id: groupId }, select: { level: true } });
    if (!targetGroup || targetGroup.level >= result.groupLevel) {
      return NextResponse.json({ error: "Cannot assign user to a group at or above your level" }, { status: 403 });
    }
  }

  const data: Record<string, unknown> = {};
  if (email) data.email = email;
  if (name) data.name = name;
  if (role) data.role = role;
  if (groupId) data.groupId = groupId;
  if (typeof isActive === "boolean") data.isActive = isActive;
  // staffId is only touched when the key is present (so {id,isActive} toggles
  // don't clear an existing link). An empty value unlinks; a real id links.
  if (staffId !== undefined) {
    const linkStaffId = normalizeStaffId(staffId);
    if (await staffLinkConflict(linkStaffId, id)) {
      return NextResponse.json({ error: "That staff is already linked to another login" }, { status: 409 });
    }
    data.staffId = linkStaffId;
  }
  if (password) {
    const { valid, errors } = validatePassword(password);
    if (!valid) {
      return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
    }
    data.passwordHash = await hash(password, 12);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  return NextResponse.json(user);
}

export async function DELETE(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (id === result.userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { group: { select: { level: true } } },
  });
  if (targetUser?.group && targetUser.group.level >= result.groupLevel) {
    return NextResponse.json({ error: "Cannot delete a user at or above your group level" }, { status: 403 });
  }

  // Delete the user's PRIVATE saved graph views first. The FK uses onDelete: SetNull,
  // which keeps their SHARED views as department-owned (ownerId = null) but would leave
  // private views (isShared = false) invisible to everyone — dead rows. Remove them.
  await prisma.savedGraphView.deleteMany({ where: { ownerId: id, isShared: false } });

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
