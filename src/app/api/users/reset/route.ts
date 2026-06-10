import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { assertUsersAdminSurvives, AdminGuardError } from "@/lib/user-lifecycle";
import { USER_SELECT, toClientUser } from "@/lib/user-view";
import { canManageGroupLevel } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";

// Reset a STAFF-LINKED login back to a bare, disabled shell: disabled, no email, no
// password. The row + its staff link are kept (the staff member stays in the system).
// This is the only "removal" action allowed for staff logins — they can't be deleted
// from /users (see DELETE in ../route.ts); deletion happens only via the staff lifecycle.
export async function POST(req: NextRequest) {
  const result = await getSession("users:edit");
  if (result.error) return result.error;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { id },
    select: { staffId: true, group: { select: { level: true } } },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!target.staffId) {
    return NextResponse.json({ error: "Reset is only for staff-linked logins" }, { status: 400 });
  }
  if (!canManageGroupLevel(result.groupLevel, target.group.level)) {
    return NextResponse.json({ error: "Cannot reset a user above your group level" }, { status: 403 });
  }

  // Admin-safety: a reset disables the login, so it must not remove the last administrator.
  try {
    await assertUsersAdminSurvives({ kind: "updateUser", userId: id, isActive: false });
  } catch (e) {
    if (e instanceof AdminGuardError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }

  const user = await prisma.user.update({
    where: { id },
    data: { isActive: false, email: null, passwordHash: null },
    select: USER_SELECT,
  });
  return NextResponse.json(toClientUser(user));
}
