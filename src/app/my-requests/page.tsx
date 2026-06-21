import { prisma } from "@/lib/prisma";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { MyRequestsPage } from "./my-requests-page";
import { resolveOffStrategyOrder } from "@/lib/schedule-requests";

export const dynamic = "force-dynamic";

export default async function MyRequests() {
  const result = await getSession("requests:self");
  if (result.error) redirect("/login");

  // Has the permission but no linked staff yet — show a friendly notice.
  if (!result.staffId) {
    return (
      <main className="flex flex-col h-dvh">
        <NavHeader />
        <div className="flex-1 grid place-items-center p-6 bg-slate-950 text-slate-300">
          <div className="max-w-md text-center space-y-2">
            <h1 className="text-lg font-semibold text-slate-100">My Requests</h1>
            <p className="text-sm text-slate-400">
              Your login isn&apos;t linked to a staff record yet. Ask an administrator to link
              your account so you can enter schedule requests.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const [staff, requests, shiftTypes, schedPrefs] = await Promise.all([
    prisma.staff.findUnique({ where: { id: result.staffId }, select: { name: true, initials: true, offStrategyOrder: true } }),
    prisma.scheduleRequest.findMany({ where: { staffId: result.staffId }, orderBy: { receivedAt: "desc" } }),
    prisma.shiftType.findMany({ select: { id: true, code: true, name: true, isLeave: true, isOffShift: true }, orderBy: { code: "asc" } }),
    prisma.schedulingPreferences.findFirst(),
  ]);

  // The order to seed the day-off widget: this staff's saved override → dept default,
  // read leniently against the current leave shifts (drops since-deleted ones).
  const leaveShiftIds = new Set(shiftTypes.filter((s) => s.isLeave && !s.isOffShift).map((s) => s.id));
  const offStrategyDefault = resolveOffStrategyOrder(
    staff?.offStrategyOrder,
    schedPrefs?.defaultOffStrategyOrder,
    leaveShiftIds,
  );

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />
      <MyRequestsPage
        staffName={staff?.name ?? "You"}
        dateFormat={schedPrefs?.dateFormat ?? "MMMM D, YYYY"}
        maxLeavePerDay={schedPrefs?.maxLeavePerDay ?? 0}
        shiftTypes={shiftTypes}
        offStrategyDefault={offStrategyDefault}
        initialRequests={requests.map((r) => ({
          id: r.id,
          staffId: r.staffId,
          startDate: r.startDate.toISOString().split("T")[0],
          endDate: r.endDate.toISOString().split("T")[0],
          kind: r.kind as "OFF" | "LEAVE" | "NEGATE_SHIFT" | "REQUEST_SHIFT",
          shiftTypeIds: r.shiftTypeIds,
          leaveShiftTypeId: r.leaveShiftTypeId,
          strength: r.strength as "hard" | "soft",
          status: r.status as "pending" | "approved" | "declined" | "withdrawn" | "fulfilled",
          source: r.source,
          offStrategyOrder: r.offStrategyOrder,
          receivedAt: r.receivedAt.toISOString(),
          approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
          notes: r.notes,
        }))}
      />
    </main>
  );
}
