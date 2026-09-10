import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getPayPeriods } from "@/lib/pay-periods-server";
import { isValidDateString, isValidPeriodLength, MIN_PERIOD_LENGTH_DAYS, MAX_PERIOD_LENGTH_DAYS } from "@/lib/pay-periods";
import { NextRequest, NextResponse } from "next/server";

function serialize(periods: { id: string; startDate: Date; endDate: Date; targetHours: number }[]) {
  return periods.map((p) => ({
    id: p.id,
    startDate: p.startDate.toISOString().split("T")[0],
    endDate: p.endDate.toISOString().split("T")[0],
    targetHours: p.targetHours,
  }));
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { targetHours } = await req.json();

  if (targetHours !== undefined) {
    if (typeof targetHours !== "number" || !Number.isFinite(targetHours) || targetHours <= 0) {
      return NextResponse.json({ error: "targetHours must be a positive number" }, { status: 400 });
    }
    await prisma.payPeriod.updateMany({
      data: { targetHours },
    });
  }

  return NextResponse.json(serialize(await getPayPeriods()));
}

// Sets the pay-period ladder: an anchor date (any real period start) + period
// length in days. Periods themselves are derived — regenerated here and
// auto-extended on read as years roll over, so there is nothing to count.
export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { anchorDate, periodLengthDays } = await req.json();

  if (!isValidDateString(anchorDate)) {
    return NextResponse.json({ error: "anchorDate must be a valid YYYY-MM-DD date" }, { status: 400 });
  }
  if (!isValidPeriodLength(periodLengthDays)) {
    return NextResponse.json(
      { error: `periodLengthDays must be an integer between ${MIN_PERIOD_LENGTH_DAYS} and ${MAX_PERIOD_LENGTH_DAYS}` },
      { status: 400 },
    );
  }

  await prisma.schedulingPreferences.upsert({
    where: { id: "default" },
    update: { payPeriodAnchor: new Date(anchorDate + "T00:00:00Z"), payPeriodLengthDays: periodLengthDays },
    create: { id: "default", payPeriodAnchor: new Date(anchorDate + "T00:00:00Z"), payPeriodLengthDays: periodLengthDays },
  });

  // getPayPeriods sees the new ladder, mismatches the stored rows, regenerates
  // (preserving the existing targetHours).
  return NextResponse.json(serialize(await getPayPeriods()));
}
