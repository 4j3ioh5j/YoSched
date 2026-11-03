import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { validatePassword } from "@/lib/password";
import { assertUsersAdminSurvives, AdminGuardError, unlinkLogin } from "@/lib/user-lifecycle";
import { parseStaffIdField, checkLinkTarget, isStaffIdUniqueViolation, linkTakenMessage, type LinkCheck } from "@/lib/staff-login-link";
import { Prisma } from "@/generated/prisma/client";
import { USER_SELECT, toClientUser, isHiddenStaffLogin } from "@/lib/user-view";
import { canManageGroupLevel } from "@/lib/permissions";
import { mustChangeAfterAdminSet } from "@/lib/must-change-password";
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";

type Tx = Prisma.TransactionClient;

/** Raised inside a transaction to abort it with an HTTP error. */
class LinkError extends Error {
  constructor(public check: Extract<LinkCheck, { ok: false }>) {
    super(check.error);
  }
}

/** Rule 1: validate linking `userId` (null = a new login) to `staffId` inside the tx. */
async function assertLinkable(tx: Tx, staffId: string, userId: string | null) {
  const staff = await tx.staff.findUnique({ where: { id: staffId }, select: { id: true, initials: true, isActive: true } });
  const holder = await tx.user.findUnique({ where: { staffId }, select: { id: true, name: true } });
  const check = checkLinkTarget(staff, holder, userId);
  if (!check.ok) throw new LinkError(check);
}

/** Map write errors to JSON: link conflicts (incl. the unique-index race) and email clashes. */
async function linkConflictResponse(e: unknown, staffId: string | null): Promise<NextResponse | null> {
  if (e instanceof LinkError) return NextResponse.json({ error: e.check.error }, { status: e.check.status });
  if (isStaffIdUniqueViolation(e) && staffId) {
    // Lost a race with another link of the same staff member: report who holds it now.
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { initials: true } });
    const holder = await prisma.user.findUnique({ where: { staffId }, select: { name: true } });
    const error = staff && holder ? linkTakenMessage(staff.initials, holder.name) : "That staff member is already linked to another login";
    return NextResponse.json({ error }, { status: 409 });
  }
  if (e && typeof e === "object" && (e as { code?: unknown }).code === "P2002") {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }
  return null;
}

export async function GET() {
  const { error } = await getSession("users:view");
  if (error) return error;

  const users = await prisma.user.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: "asc" },
  });
  // Hide non-admin logins still linked to an INACTIVE staff member (legacy rows from the
  // old reset-on-deactivate lifecycle; deactivation now unlinks instead).
  return NextResponse.json(users.filter((u) => !isHiddenStaffLogin(u)).map(toClientUser));
}

export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { email, name, password, groupId, staffId: rawStaffId } = await req.json();
  const staffField = parseStaffIdField(rawStaffId);
  if (staffField.kind === "invalid") return NextResponse.json({ error: "Invalid staffId" }, { status: 400 });
  const linkStaffId = staffField.kind === "link" ? staffField.staffId : null;
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
  try {
    const user = await prisma.$transaction(async (tx) => {
      if (linkStaffId) await assertLinkable(tx, linkStaffId, null);
      return tx.user.create({
        // An admin-chosen password: the new person must replace it at first sign-in.
        data: { email, name, passwordHash, mustChangePassword: true, groupId: finalGroupId, ...(linkStaffId ? { staffId: linkStaffId } : {}) },
        select: USER_SELECT,
      });
    });
    return NextResponse.json(toClientUser(user));
  } catch (e) {
    const res = await linkConflictResponse(e, linkStaffId);
    if (res) return res;
    throw e;
  }
}

export async function PUT(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { id, email, name, password, groupId, isActive, staffId: rawStaffId } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const staffField = parseStaffIdField(rawStaffId);
  if (staffField.kind === "invalid") return NextResponse.json({ error: "Invalid staffId" }, { status: 400 });

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { email: true, passwordHash: true, group: { select: { level: true } } },
  });
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
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
    // Someone else's password set by an admin must be replaced at their next sign-in.
    data.mustChangePassword = mustChangeAfterAdminSet(id, result.userId);
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

  const linkStaffId = staffField.kind === "link" ? staffField.staffId : null;
  try {
    const out = await prisma.$transaction(async (tx) => {
      if (linkStaffId) {
        await assertLinkable(tx, linkStaffId, id);
        data.staffId = linkStaffId;
      }
      const updated = await tx.user.update({ where: { id }, data, select: USER_SELECT });
      if (staffField.kind !== "unlink") return { user: updated };
      // Rule 4: unlink AFTER the field update, so a shell that was just given an email or
      // password in this same save counts as a real login and is detached, not deleted.
      const action = await unlinkLogin(id, tx);
      if (action === "delete") return { deleted: true as const };
      return { user: await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT }) };
    });
    if ("deleted" in out) return NextResponse.json({ deleted: true, id });
    return NextResponse.json(toClientUser(out.user));
  } catch (e) {
    const res = await linkConflictResponse(e, linkStaffId);
    if (res) return res;
    throw e;
  }
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
  // Rule 5: a staff-linked login can't be deleted here — unlink it first (or use Reset).
  if (targetUser?.staffId) {
    return NextResponse.json(
      { error: "This login is linked to a staff member and can't be deleted. Unlink it first, or use Reset." },
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
