import { prisma } from "@/lib/prisma";
import { getSessionRole } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { UsersPage } from "./users-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sessionRole = await getSessionRole();
  if (!sessionRole || sessionRole.role !== "admin") redirect("/");

  const [users, prefs] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.schedulingPreferences.findFirst(),
  ]);

  return (
    <>
      <NavHeader />
      <UsersPage initialUsers={users} currentUserId={sessionRole!.userId} deviceTrustDays={prefs?.deviceTrustDays ?? 30} dateFormat={prefs?.dateFormat ?? "MMMM D, YYYY"} />
    </>
  );
}
