import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validatePassword } from "@/lib/password";
import { assertUsersAdminSurvives, AdminGuardError } from "@/lib/user-lifecycle";
import { USER_SELECT, toClientUser, isHiddenStaffLogin } from "@/lib/user-view";
import { canManageGroupLevel } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";

export async function GET() {
  const { error } = await getSession("users:view");
  if (error) return error;

  const users = await prisma.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  // Hide logins belonging to deactivated staff — they've been reset to bare shells and
  // re-appear only if the staff member is reactivated (see resetLoginForStaff).
  return NextResponse.json(users.filter((u) => !isHiddenStaffLogin(u)).map(toClientUser));
}

export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { email, name, password, groupId } = await req.json();
  if (!email || !name || !password) {
    return NextResponse.json({ error: "Email, name, and password required" }, { status: 400 });
  }

  const { valid, errors } = validatePassword(password);
  if (!valid) {
    return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
  }

  if (groupId) {
    const targetGroup = await prisma.group.findUnique({ where: { id: groupId }, select: { level: true } });
    if (!targetGroup || !canManageGroupLevel(result.groupLevel, targetGroup.level)) {
      return NextResponse.json({ error: "Cannot assign user to a group above your level" }, { status: 403 });
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  // Every user must belong to a group. Use the requested group, else fall back to "Staff".
  const defaultGroup = groupId ? undefined : await prisma.group.findUnique({ where: { name: "Staff" }, select: { id: true } });
  const finalGroupId = groupId || defaultGroup?.id;
  if (!finalGroupId) {
    return NextResponse.json({ error: 'No group specified and the default "Staff" group is missing' }, { status: 400 });
  }
  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, groupId: finalGroupId },
    select: USER_SELECT,
  });

  return NextResponse.json(toClientUser(user));
}

export async function PUT(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { id, email, name, password, groupId, isActive } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { email: true, passwordHash: true, group: { select: { level: true } } },
  });
  if (targetUser && !canManageGroupLevel(result.groupLevel, targetUser.group.level)) {
    return NextResponse.json({ error: "Cannot edit a user above your group level" }, { status: 403 });
  }

  if (groupId) {
    const targetGroup = await prisma.group.findUnique({ where: { id: groupId }, select: { level: true } });
    if (!targetGroup || !canManageGroupLevel(result.groupLevel, targetGroup.level)) {
      return NextResponse.json({ error: "Cannot assign user to a group above your level" }, { status: 403 });
    }
  }

  const data: Record<string, unknown> = {};
  if (email) data.email = email;
  if (name) data.name = name;
  if (groupId) data.groupId = groupId;
  if (typeof isActive === "boolean") data.isActive = isActive;
  if (password) {
    const { valid, errors } = validatePassword(password);
    if (!valid) {
      return NextResponse.json({ error: `Password requirements: ${errors.join(", ")}` }, { status: 400 });
    }
    data.passwordHash = await hash(password, 12);
  }

  // Gate 3 of activation: a login may only be enabled once it has both an email and a
  // password (set here or already present). Keeps "Active" honest for shell logins.
  if (isActive === true) {
    const willHaveEmail = email || targetUser?.email;
    const willHavePassword = !!password || !!targetUser?.passwordHash;
    if (!willHaveEmail || !willHavePassword) {
      return NextResponse.json({ error: "Set an email and password before activating this login" }, { status: 400 });
    }
  }

  // Admin-safety: a group/active change must not remove the last administrator.
  if (groupId || typeof isActive === "boolean") {
    try {
      await assertUsersAdminSurvives({
        kind: "updateUser",
        userId: id,
        ...(groupId ? { groupId } : {}),
        ...(typeof isActive === "boolean" ? { isActive } : {}),
      });
    } catch (e) {
      if (e instanceof AdminGuardError) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  return NextResponse.json(toClientUser(user));
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
    select: { staffId: true, group: { select: { level: true } } },
  });
  // Staff-linked logins are subordinate to the staff record and can NEVER be deleted here
  // — use Reset, or deactivate/delete the staff member (which resets/deletes the login).
  if (targetUser?.staffId) {
    return NextResponse.json(
      { error: "This login belongs to a staff member and can't be deleted. Use Reset, or deactivate/delete the staff member." },
      { status: 400 },
    );
  }
  if (targetUser && !canManageGroupLevel(result.groupLevel, targetUser.group.level)) {
    return NextResponse.json({ error: "Cannot delete a user above your group level" }, { status: 403 });
  }

  // Admin-safety: never delete the last administrator who can manage users.
  try {
    await assertUsersAdminSurvives({ kind: "deleteUser", userId: id });
  } catch (e) {
    if (e instanceof AdminGuardError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  // Delete the user's PRIVATE saved graph views first. The FK uses onDelete: SetNull,
  // which keeps their SHARED views as department-owned (ownerId = null) but would leave
  // private views (isShared = false) invisible to everyone — dead rows. Remove them.
  await prisma.savedGraphView.deleteMany({ where: { ownerId: id, isShared: false } });

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
