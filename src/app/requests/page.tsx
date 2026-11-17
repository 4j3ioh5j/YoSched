import { prisma } from "@/lib/prisma";
import { NavHeader } from "../nav-header";
import { getPageSession } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { RequestsPage } from "./requests-page";
import { archivedMonths, dateInZone, parseArchiveDays, parseArchiveLeaveRule } from "@/lib/request-lines";

export const dynamic = "force-dynamic";

export default async function Requests({ searchParams }: { searchParams: Promise<{ archive?: string | string[] }> }) {
  const { error, permissions } = await getPageSession("requests:view");
  if (error) redirect("/login");
  const canEdit = permissions!.includes("schedule:edit");

  const [requests, staff, shiftTypes, schedPrefs] = await Promise.all([
    prisma.scheduleRequest.findMany({ orderBy: { receivedAt: "desc" } }),
    prisma.staff.findMany({ select: { id: true, initials: true, name: true } }),
    prisma.shiftType.findMany({ select: { id: true, code: true, isOffShift: true, isLeave: true } }),
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

  // Card #332: a finished month's days move to the Archive, judged live from the schedule.
  const today = dateInZone(new Date(), schedPrefs?.timeZone);
  const archiveDays = parseArchiveDays(schedPrefs?.requestArchiveDays);
  const leaveRule = parseArchiveLeaveRule(schedPrefs?.archiveLeaveMetBy);
  const months = archivedMonths(
    requests.map((r) => ({ startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10) })),
    today,
    archiveDays,
  );
  const asked = (await searchParams).archive;
  const archiveMonth = typeof asked === "string" && months.includes(asked) ? asked : months[0] ?? null;
  const archiveCells: Record<string, string> = {};
  const archiveNotes: Record<string, string> = {};
  if (archiveMonth) {
    const y = +archiveMonth.slice(0, 4);
    const m = +archiveMonth.slice(5, 7);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0));
    const staffIds = [...new Set(requests.filter((r) => r.startDate <= to && r.endDate >= from).map((r) => r.staffId))];
    const [cells, notes] = await Promise.all([
      prisma.assignment.findMany({
        where: { staffId: { in: staffIds }, date: { gte: from, lte: to } },
        select: { staffId: true, date: true, shiftTypeId: true },
      }),
      prisma.requestDayNote.findMany({
        where: { staffId: { in: staffIds }, date: { gte: from, lte: to } },
        select: { staffId: true, date: true, note: true },
      }),
    ]);
    for (const c of cells) archiveCells[`${c.staffId}|${c.date.toISOString().slice(0, 10)}`] = c.shiftTypeId;
    for (const n of notes) archiveNotes[`${n.staffId}|${n.date.toISOString().slice(0, 10)}`] = n.note;
  }
  const shiftFacts: Record<string, { isOff: boolean; isLeave: boolean }> = {};
  for (const s of shiftTypes) shiftFacts[s.id] = { isOff: s.isOffShift, isLeave: s.isLeave };

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
        archive={{ today, archiveDays, leaveRule, months, month: archiveMonth, cells: archiveCells, notes: archiveNotes, shiftFacts, opened: asked !== undefined }}
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
          flaggedReason: r.flaggedReason,
        }))}
      />
    </main>
  );
}
