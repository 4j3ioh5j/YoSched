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
    select: { id: true, email: true, name: true, totpEnabled: true, mustChangePassword: true, group: { select: { name: true } } },
  });
  if (!user) redirect("/login");

  return (
    <>
      <NavHeader />
      <AccountPage
        user={{ ...user, groupName: user.group?.name }}
        // The DB decides whether a change is pending; the token's copy can be stale either way.
        mustChangePassword={user.mustChangePassword}
        tokenSaysPending={(session.user as { mustChangePassword?: boolean }).mustChangePassword === true}
      />
    </>
  );
}
