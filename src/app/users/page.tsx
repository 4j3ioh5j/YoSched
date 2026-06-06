import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { UsersPage } from "./users-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getSession("users:view");
  if (result.error) redirect("/");

  const [users, prefs, groups, providers] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, groupId: true, providerId: true, isActive: true, totpEnabled: true, createdAt: true,
        group: { select: { name: true, level: true } },
        provider: { select: { id: true, name: true, initials: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.schedulingPreferences.findFirst(),
    prisma.group.findMany({
      orderBy: { level: "desc" },
      select: { id: true, name: true, level: true },
    }),
    prisma.provider.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, initials: true },
    }),
  ]);

  return (
    <>
      <NavHeader />
      <UsersPage
        initialUsers={users}
        currentUserId={result.userId!}
        currentGroupLevel={result.groupLevel!}
        groups={groups}
        providers={providers}
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
