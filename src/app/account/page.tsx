import { auth } from "@/lib/auth";
import { getSession, isTotpRequired } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { NavHeader } from "../nav-header";
import { AccountPage } from "./account-page";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Card #319: the same checks as every API (a revoked session signs in again), with the two
  // exemptions this page exists for: changing the password and setting up two-factor.
  const { error } = await getSession(undefined, { allowPendingPasswordChange: true, allowPendingTotpSetup: true });
  if (error) redirect("/login?relogin=1");

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
        totpRequired={await isTotpRequired()}
      />
    </>
  );
}
