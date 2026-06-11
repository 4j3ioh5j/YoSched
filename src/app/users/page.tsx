import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { USER_SELECT, toClientUser, isHiddenStaffLogin } from "@/lib/user-view";
import { parseUserSort } from "@/lib/users-sort";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { UsersPage } from "./users-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getSession("users:view");
  if (result.error) redirect("/");

  const [rawUsers, prefs, groups, me] = await Promise.all([
    prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: "asc" },
    }),
    prisma.schedulingPreferences.findFirst(),
    prisma.group.findMany({
      orderBy: { level: "desc" },
      select: { id: true, name: true, level: true },
    }),
    prisma.user.findUnique({
      where: { id: result.userId! },
      select: { uiPreferences: true },
    }),
  ]);

  // Per-login persisted sort for the users table (parsed defensively — junk/missing → null,
  // which the client treats as the default createdAt order).
  const uiPrefs =
    me?.uiPreferences && typeof me.uiPreferences === "object" && !Array.isArray(me.uiPreferences)
      ? (me.uiPreferences as Record<string, unknown>)
      : {};
  const initialSort = parseUserSort(uiPrefs.usersTableSort);

  // Same shape + filtering as GET /api/users: hide deactivated-staff logins and strip
  // the password hash (toClientUser derives loginComplete; the hash never reaches the client).
  const users = rawUsers.filter((u) => !isHiddenStaffLogin(u)).map(toClientUser);

  return (
    <>
      <NavHeader />
      <UsersPage
        initialUsers={users}
        initialSort={initialSort}
        currentUserId={result.userId!}
        currentGroupLevel={result.groupLevel!}
        groups={groups}
        canEditUsers={result.permissions!.includes("users:edit")}
        canViewGroups={result.permissions!.includes("groups:view")}
        canEditGroups={result.permissions!.includes("groups:edit")}
        canEditSettings={result.permissions!.includes("settings:edit")}
        deviceTrustDays={prefs?.deviceTrustDays ?? 30}
        dateFormat={prefs?.dateFormat ?? "MMMM D, YYYY"}
      />
    </>
  );
}
