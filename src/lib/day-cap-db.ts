import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { buildDayCapLookup, dayCapMessage, type DayCapLookup } from "@/lib/day-cap";

/**
 * Server-side per-day caps for the manual write routes: Staffing Rules "Max"
 * (staffing_requirements.maxCount) resolved for the given dates (holiday rows on
 * holidays). See src/lib/day-cap.ts.
 */
export type DayCaps = {
  capOf: DayCapLookup;
  /** The 409 the routes return when an edit would exceed a cap. */
  dayFull: (shiftTypeId: string, date: string) => NextResponse;
};

export async function loadDayCaps(dates: readonly string[]): Promise<DayCaps> {
  const uniq = [...new Set(dates)];
  const [reqs, shiftTypes, hols] = await Promise.all([
    prisma.staffingRequirement.findMany({ where: { maxCount: { not: null } }, select: { shiftCode: true, dayKey: true, maxCount: true } }),
    prisma.shiftType.findMany({ select: { id: true, code: true } }),
    uniq.length
      ? prisma.holiday.findMany({ where: { date: { in: uniq.map((d) => new Date(d + "T00:00:00Z")) } }, select: { date: true } })
      : Promise.resolve([] as { date: Date }[]),
  ]);
  const holidays = hols.map((h) => h.date.toISOString().split("T")[0]);
  const capOf = buildDayCapLookup(reqs, shiftTypes, holidays);
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  return {
    capOf,
    dayFull: (shiftTypeId, date) => {
      const code = codeById.get(shiftTypeId) ?? "that shift";
      const cap = capOf(shiftTypeId, date) ?? 0;
      return NextResponse.json(
        { error: dayCapMessage(code, cap, date, holidays), reason: "day-full", code, maxPerDay: cap, date },
        { status: 409 },
      );
    },
  };
}
