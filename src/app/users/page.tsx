import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { UsersPage } from "./users-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getSession("users:view");
  if (result.error) redirect("/");

  const [rawUsers, prefs, groups] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, groupId: true, staffId: true, isActive: true, totpEnabled: true, createdAt: true,
        passwordHash: true,
        group: { select: { name: true, level: true } },
        staff: { select: { id: true, name: true, initials: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.schedulingPreferences.findFirst(),
    prisma.group.findMany({
      orderBy: { level: "desc" },
      select: { id: true, name: true, level: true },
    }),
  ]);

  // Derive loginComplete (has both email + password) server-side; the hash never
  // crosses to the client.
  const users = rawUsers.map(({ passwordHash, ...u }) => ({ ...u, loginComplete: !!u.email && !!passwordHash }));

  return (
    <>
      <NavHeader />
      <UsersPage
        initialUsers={users}
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
