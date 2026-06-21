import { prisma } from "@/lib/prisma";
import { NavHeader } from "../nav-header";
import { getSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { RequestsPage } from "./requests-page";

export const dynamic = "force-dynamic";

export default async function Requests() {
  const { error, permissions } = await getSession("requests:view");
  if (error) redirect("/login");
  const canEdit = permissions!.includes("schedule:edit");

  const [requests, staff, shiftTypes, schedPrefs] = await Promise.all([
    prisma.scheduleRequest.findMany({ orderBy: { receivedAt: "desc" } }),
    prisma.staff.findMany({ select: { id: true, initials: true, name: true } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
    prisma.schedulingPreferences.findFirst(),
  ]);

  // Approver names: only the schedulers actually referenced, NAME only (never
  // email), and only for editors — viewers must not receive the user directory.
  const approverName: Record<string, string> = {};
  if (canEdit) {
    const approverIds = [...new Set(requests.map((r) => r.approvedBy).filter((x): x is string => !!x))];
    if (approverIds.length > 0) {
      const approvers = await prisma.user.findMany({
        where: { id: { in: approverIds } },
        select: { id: true, name: true },
      });
      for (const u of approvers) approverName[u.id] = u.name ?? "Unknown";
    }
  }

  const staffName: Record<string, { initials: string; name: string }> = {};
  for (const p of staff) staffName[p.id] = { initials: p.initials, name: p.name };
  const shiftCode: Record<string, string> = {};
  for (const s of shiftTypes) shiftCode[s.id] = s.code;

  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />
      <RequestsPage
        canEdit={canEdit}
        staffName={staffName}
        shiftCode={shiftCode}
        dateFormat={schedPrefs?.dateFormat ?? "MMMM D, YYYY"}
        requests={requests.map((r) => ({
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
          // Resolve to a display name server-side; never serialize the raw user id.
          // null for viewers (no schedule:edit) — they see the date, not who.
          approverLabel: canEdit && r.approvedBy ? approverName[r.approvedBy] ?? "Unknown" : null,
          notes: r.notes,
        }))}
      />
    </main>
  );
}
