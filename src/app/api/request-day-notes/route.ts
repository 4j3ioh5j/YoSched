// Card #332: a note on an archived Requests line ("why it was not met"), kept per person and
// day in request_day_notes — never on the request row, so deleting, undoing or restoring a
// request leaves it alone. Only archived days take a note; that is checked here, at write
// time only (a backup's notes restore whatever the archive setting is by then).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { gated } from "@/lib/write-gate";
import { isValidDateStr } from "@/lib/schedule-requests";
import { dateInZone, isArchivedDay, parseArchiveDays } from "@/lib/request-lines";

export const NOTE_MAX = 500;
export const DATES_MAX = 62;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function handlePUT(req: NextRequest) {
  const { error } = await getSession("schedule:edit");
  if (error) return error;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Expected a JSON body");
  }
  if (!body || typeof body !== "object") return bad("Expected a JSON body");
  const { staffId, dates, note } = body as { staffId?: unknown; dates?: unknown; note?: unknown };
  if (typeof staffId !== "string" || !staffId) return bad("staffId is required");
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > DATES_MAX || !dates.every(isValidDateStr)) {
    return bad(`dates must be 1 to ${DATES_MAX} dates (YYYY-MM-DD)`);
  }
  if (note !== null && typeof note !== "string") return bad("note must be text or null");
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > NOTE_MAX) return bad(`A note can be at most ${NOTE_MAX} characters`);

  const prefs = await prisma.schedulingPreferences.findFirst();
  const today = dateInZone(new Date(), prefs?.timeZone);
  const wait = parseArchiveDays(prefs?.requestArchiveDays);
  const unique = [...new Set(dates as string[])];
  if (!unique.every((d) => isArchivedDay(d, today, wait))) {
    return bad("Notes can be added only to archived days (the month is over). Reload the page.");
  }
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } });
  if (!staff) return bad("Staff member not found", 404);

  const asDates = unique.map((d) => new Date(d + "T00:00:00Z"));
  if (!text) {
    await prisma.requestDayNote.deleteMany({ where: { staffId, date: { in: asDates } } });
  } else {
    await prisma.$transaction(
      asDates.map((date) =>
        prisma.requestDayNote.upsert({
          where: { staffId_date: { staffId, date } },
          create: { staffId, date, note: text },
          update: { note: text },
        }),
      ),
    );
  }
  return NextResponse.json({ staffId, dates: unique, note: text || null });
}

export const PUT = gated(handlePUT);
