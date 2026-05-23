import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { UsersPage } from "./users-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const role = (session?.user as { role?: string })?.role;
  if (role !== "admin") redirect("/");

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <>
      <NavHeader />
      <UsersPage initialUsers={users} currentUserId={session!.user!.id!} />
    </>
  );
}
