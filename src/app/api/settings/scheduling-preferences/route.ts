import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidDateFormat } from "@/lib/date-format";
import { isPendingRequestMode, PENDING_REQUEST_MODES, isRequestConflictPolicy, REQUEST_CONFLICT_POLICIES, validateOffStrategyOrder } from "@/lib/schedule-requests";

export async function GET() {
  const { error } = await getSession("settings:view");
  if (error) return error;
  let prefs = await prisma.schedulingPreferences.findFirst();
  if (!prefs) {
    prefs = await prisma.schedulingPreferences.create({
      data: { id: "default" },
    });
  }
  return NextResponse.json(prefs);
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const body = await req.json();
  const { prefer3DayWeekends, prefer4DayWeekends, preferSequentialOff, deviceTrustDays, dateFormat, maxLeavePerDay, pendingRequestMode, requestConflictPolicy, defaultOffStrategyOrder } = body;

  // Mode is STRICTLY validated on write — a bad value is rejected, never coerced to
  // the default (which would silently turn a typo into "full"). Reads stay lenient.
  if (pendingRequestMode !== undefined && !isPendingRequestMode(pendingRequestMode)) {
    return NextResponse.json({ error: `pendingRequestMode must be one of ${PENDING_REQUEST_MODES.join(", ")}` }, { status: 400 });
  }
  if (requestConflictPolicy !== undefined && !isRequestConflictPolicy(requestConflictPolicy)) {
    return NextResponse.json({ error: `requestConflictPolicy must be one of ${REQUEST_CONFLICT_POLICIES.join(", ")}` }, { status: 400 });
  }

  // Department-default day-off fulfillment order: validate LEAVE:<id> tokens against
  // the currently eligible leave shift types (strict on write). Only touched when sent.
  let offOrder: string[] | undefined;
  if (defaultOffStrategyOrder !== undefined) {
    const leaveShiftIds = new Set(
      (await prisma.shiftType.findMany({ where: { isLeave: true, isOffShift: false }, select: { id: true } })).map((s) => s.id)
    );
    const validated = validateOffStrategyOrder(defaultOffStrategyOrder, leaveShiftIds);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    offOrder = validated.value;
  }

  const prefs = await prisma.schedulingPreferences.upsert({
    where: { id: "default" },
    update: {
      ...(typeof prefer3DayWeekends === "boolean" && { prefer3DayWeekends }),
      ...(typeof prefer4DayWeekends === "boolean" && { prefer4DayWeekends }),
      ...(typeof preferSequentialOff === "boolean" && { preferSequentialOff }),
      ...(typeof deviceTrustDays === "number" && deviceTrustDays >= 1 && deviceTrustDays <= 365 && { deviceTrustDays: Math.floor(deviceTrustDays) }),
      ...(typeof dateFormat === "string" && isValidDateFormat(dateFormat) && { dateFormat }),
      ...(typeof maxLeavePerDay === "number" && maxLeavePerDay >= 0 && maxLeavePerDay <= 999 && { maxLeavePerDay: Math.floor(maxLeavePerDay) }),
      ...(isPendingRequestMode(pendingRequestMode) && { pendingRequestMode }),
      ...(isRequestConflictPolicy(requestConflictPolicy) && { requestConflictPolicy }),
      ...(offOrder !== undefined && { defaultOffStrategyOrder: offOrder }),
    },
    create: {
      id: "default",
      prefer3DayWeekends: prefer3DayWeekends ?? true,
      prefer4DayWeekends: prefer4DayWeekends ?? true,
      preferSequentialOff: preferSequentialOff ?? true,
      ...(typeof dateFormat === "string" && isValidDateFormat(dateFormat) && { dateFormat }),
      ...(isPendingRequestMode(pendingRequestMode) && { pendingRequestMode }),
      ...(isRequestConflictPolicy(requestConflictPolicy) && { requestConflictPolicy }),
      ...(offOrder !== undefined && { defaultOffStrategyOrder: offOrder }),
    },
  });

  return NextResponse.json(prefs);
}
