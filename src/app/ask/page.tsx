import { prisma } from "@/lib/prisma";
import { loadRawStatsData } from "@/lib/graph/load-raw";
import { getPageSession } from "@/lib/auth-guard";
import { resolveZone, wallClock } from "@/lib/time-zone";
import { DEFAULT_DATE_FORMAT, isValidDateFormat } from "@/lib/date-format";
import type { AskData } from "@/lib/ask/engine";
import { NavHeader } from "../nav-header";
import { AskPage } from "./ask-page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The calendar date of an instant in the Settings time zone, as YYYY-MM-DD. */
function zoneDate(at: Date, zone: string): string {
  const w = wallClock(at, zone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

// Card #367: "Ask the schedule". Like Statistics, this page ships the schedule itself to the
// browser (every question is answered there), so it needs schedule:view as well as statistics:view.
// Requests are shipped only to people who may see them (requests:view).
export default async function Ask() {
  const session = await getPageSession(["statistics:view", "schedule:view"]);
  if (session.error) redirect("/");
  const canSeeRequests = session.permissions.includes("requests:view");
  const [{ raw, schedPrefs, shiftTypes, holidays }, holidayTypes, requests, saved] = await Promise.all([
    loadRawStatsData(),
    prisma.holidayType.findMany({ orderBy: { name: "asc" } }),
    canSeeRequests
      ? prisma.scheduleRequest.findMany({ select: { staffId: true, kind: true, status: true, receivedAt: true } })
      : Promise.resolve(null),
    // Same visibility as GET /api/ask/questions: shared ones plus the viewer's own.
    prisma.savedQuestion.findMany({
      where: { OR: [{ isShared: true }, { ownerId: session.userId }] },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, spec: true, ownerId: true, isShared: true },
    }),
  ]);
  const zone = resolveZone(schedPrefs?.timeZone);
  const data: AskData = {
    raw,
    shiftTypes: shiftTypes.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    holidays: holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, holidayTypeId: h.holidayTypeId })),
    holidayTypes: holidayTypes.map((t) => ({ id: t.id, name: t.name })),
    requests: requests
      ? requests.map((r) => ({ staffId: r.staffId, kind: r.kind, status: r.status, receivedDate: zoneDate(r.receivedAt, zone) }))
      : null,
  };
  return (
    <main className="flex flex-col h-dvh">
      <NavHeader />
      <AskPage
        data={data}
        today={zoneDate(new Date(), zone)}
        dateFormat={schedPrefs?.dateFormat && isValidDateFormat(schedPrefs.dateFormat) ? schedPrefs.dateFormat : DEFAULT_DATE_FORMAT}
        canManage={session.permissions.includes("statistics:manage")}
        initialSaved={saved}
      />
    </main>
  );
}
