import { prisma } from "@/lib/prisma";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { MyRequestsPage } from "./my-requests-page";

export const dynamic = "force-dynamic";

export default async function MyRequests() {
  const result = await getSession("requests:self");
  if (result.error) redirect("/login");

  // Has the permission but no linked provider yet — show a friendly notice.
  if (!result.providerId) {
    return (
      <main className="flex flex-col h-dvh">
        <NavHeader />
        <div className="flex-1 grid place-items-center p-6 bg-slate-950 text-slate-300">
          <div className="max-w-md text-center space-y-2">
            <h1 className="text-lg font-semibold text-slate-100">My Requests</h1>
            <p className="text-sm text-slate-400">
              Your login isn&apos;t linked to a provider record yet. Ask an administrator to link
              your account so you can enter schedule requests.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const [provider, requests, shiftTypes, schedPrefs] = await Promise.all([
    prisma.provider.findUnique({ where: { id: result.providerId }, select: { name: true, initials: true } }),
    prisma.scheduleRequest.findMany({ where: { providerId: result.providerId }, orderBy: { receivedAt: "desc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true, name: true, isLeave: true, isOffShift: true }, orderBy: { code: "asc" } }),
    prisma.schedulingPreferences.findFirst(),
  ]);

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />
      <MyRequestsPage
        providerName={provider?.name ?? "You"}
        dateFormat={schedPrefs?.dateFormat ?? "MMMM D, YYYY"}
        shiftTypes={shiftTypes}
        initialRequests={requests.map((r) => ({
          id: r.id,
          providerId: r.providerId,
          startDate: r.startDate.toISOString().split("T")[0],
          endDate: r.endDate.toISOString().split("T")[0],
          kind: r.kind as "OFF" | "LEAVE" | "NEGATE_SHIFT" | "REQUEST_SHIFT",
          shiftTypeIds: r.shiftTypeIds,
          leaveShiftTypeId: r.leaveShiftTypeId,
          strength: r.strength as "hard" | "soft",
          status: r.status as "pending" | "approved" | "declined" | "withdrawn" | "fulfilled",
          source: r.source,
          receivedAt: r.receivedAt.toISOString(),
          approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
          notes: r.notes,
        }))}
      />
    </main>
  );
}
