import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { AccountPage } from "./account-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, totpEnabled: true, group: { select: { name: true } } },
  });
  if (!user) redirect("/login");

  return (
    <>
      <NavHeader />
      <AccountPage user={{ ...user, groupName: user.group?.name }} />
    </>
  );
}
