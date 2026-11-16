import { validateTuningBody, tuningData } from "@/lib/scheduler-tuning";
import { isLeavePolicy, LEAVE_POLICIES } from "@/lib/leave-policy";
import { getSession } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { validateSpecialColumnOrder } from "@/lib/special-columns";
import { validatePrintBlock, validatePrintFontFamily, validatePrintFontSize, isDateColumnFormat, isDayColumnFormat, type PrintBlock } from "@/lib/print-layout";
import { isValidDateFormat } from "@/lib/date-format";
import { isPendingRequestMode, PENDING_REQUEST_MODES, isRequestConflictPolicy, REQUEST_CONFLICT_POLICIES, isApprovalConflictPolicy, APPROVAL_CONFLICT_POLICIES, validateOffStrategyOrder } from "@/lib/schedule-requests";
import { isLiveScope, LIVE_SCOPES } from "@/lib/live-scope";
import { isShiftShareBasis, SHIFT_SHARE_BASES } from "@/lib/shift-share";
import { isHolidayPolicy, HOLIDAY_POLICIES, isHolidayCreditShift } from "@/lib/holiday-policy";
import { isShadeColor } from "@/lib/day-shading";
import { validateStaffOrderCriteria } from "@/lib/staff-order";
import { exportFileNameError } from "@/lib/export-filename";
import { isActivationGroupDefault, isActivationNewHireDefault, ACTIVATION_GROUP_DEFAULTS, ACTIVATION_NEW_HIRE_DEFAULTS } from "@/lib/shift-activation";

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
  const { prefer3DayWeekends, prefer4DayWeekends, preferSequentialOff, deviceTrustDays, dateFormat, maxLeavePerDay, pendingRequestMode, requestConflictPolicy, approvalConflictPolicy, defaultOffStrategyOrder, defaultLiveScope, staffColumnOrder, specialColumnOrder, shiftShareBasis, holidayPolicy, leaveHoursPolicy, activationWorkedDefault, activationNeverDefault, activationNewHireDefault, shiftBalanceFrom, holidayShiftId, printWeekendColor, printHolidayColor, screenHolidayColor, printHeader, printFooter, printFontFamily, printFontSize, splitDateDayColumns, dateColumnFormat, dayColumnFormat, printPayPeriodLabels, exportFileName } = body;
  // Card #203: "Count shifts from" — a YYYY-MM-DD date, or null to clear. Strictly validated.
  const balanceFromValid = shiftBalanceFrom === null || (typeof shiftBalanceFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(shiftBalanceFrom) && !Number.isNaN(Date.parse(shiftBalanceFrom + "T00:00:00Z")) && new Date(shiftBalanceFrom + "T00:00:00Z").toISOString().startsWith(shiftBalanceFrom));
  if (shiftBalanceFrom !== undefined && !balanceFromValid) {
    return NextResponse.json({ error: "shiftBalanceFrom must be a YYYY-MM-DD date or null" }, { status: 400 });
  }
  const balanceFromData = shiftBalanceFrom === undefined ? {} : { shiftBalanceFrom: shiftBalanceFrom === null ? null : new Date(shiftBalanceFrom + "T00:00:00Z") };

  // Mode is STRICTLY validated on write — a bad value is rejected, never coerced to
  // the default (which would silently turn a typo into "full"). Reads stay lenient.
  if (pendingRequestMode !== undefined && !isPendingRequestMode(pendingRequestMode)) {
    return NextResponse.json({ error: `pendingRequestMode must be one of ${PENDING_REQUEST_MODES.join(", ")}` }, { status: 400 });
  }
  if (requestConflictPolicy !== undefined && !isRequestConflictPolicy(requestConflictPolicy)) {
    return NextResponse.json({ error: `requestConflictPolicy must be one of ${REQUEST_CONFLICT_POLICIES.join(", ")}` }, { status: 400 });
  }
  if (approvalConflictPolicy !== undefined && !isApprovalConflictPolicy(approvalConflictPolicy)) {
    return NextResponse.json({ error: `approvalConflictPolicy must be one of ${APPROVAL_CONFLICT_POLICIES.join(", ")}` }, { status: 400 });
  }
  if (defaultLiveScope !== undefined && !isLiveScope(defaultLiveScope)) {
    return NextResponse.json({ error: `defaultLiveScope must be one of ${LIVE_SCOPES.join(", ")}` }, { status: 400 });
  }
  if (shiftShareBasis !== undefined && !isShiftShareBasis(shiftShareBasis)) {
    return NextResponse.json({ error: `shiftShareBasis must be one of ${SHIFT_SHARE_BASES.join(", ")}` }, { status: 400 });
  }
  if (holidayPolicy !== undefined && !isHolidayPolicy(holidayPolicy)) {
    return NextResponse.json({ error: `holidayPolicy must be one of ${HOLIDAY_POLICIES.join(", ")}` }, { status: 400 });
  }
  // Card #207: the shift credited on a holiday — null clears it, otherwise the id of an
  // existing leave shift that counts toward hours (entitlement bypasses eligibility and
  // caps, so a working shift must never be chosen). The engine re-checks at run time.
  if (holidayShiftId !== undefined && holidayShiftId !== null) {
    const st = typeof holidayShiftId === "string"
      ? await prisma.shiftType.findUnique({ where: { id: holidayShiftId }, select: { countsTowardFte: true, isLeave: true, isOffShift: true } })
      : null;
    if (!st || !isHolidayCreditShift(st)) {
      return NextResponse.json({ error: "holidayShiftId must be null or a leave shift that counts toward hours" }, { status: 400 });
    }
  }
  const holidayShiftData = holidayShiftId === undefined ? {} : { holidayShiftId: holidayShiftId as string | null };
  // Card #209: shading colours — #RRGGBB, or null to switch that shading off. Strict.
  const shadeData: Record<string, string | null> = {};
  for (const [k, v] of [["printWeekendColor", printWeekendColor], ["printHolidayColor", printHolidayColor], ["screenHolidayColor", screenHolidayColor]] as const) {
    if (v === undefined) continue;
    if (v !== null && !isShadeColor(v)) {
      return NextResponse.json({ error: `${k} must be a #RRGGBB colour or null` }, { status: 400 });
    }
    shadeData[k] = v;
  }
  // Card #215: scheduler tuning numbers — strict on write (one shared check), never coerced.
  const tuningErr = validateTuningBody(body);
  if (tuningErr) return NextResponse.json({ error: tuningErr }, { status: 400 });
  const tuningUpdate = tuningData(body);
  if (leaveHoursPolicy !== undefined && !isLeavePolicy(leaveHoursPolicy)) {
    return NextResponse.json({ error: `leaveHoursPolicy must be one of ${LEAVE_POLICIES.join(", ")}` }, { status: 400 });
  }
  for (const [k, v] of [["activationWorkedDefault", activationWorkedDefault], ["activationNeverDefault", activationNeverDefault]] as const) {
    if (v !== undefined && !isActivationGroupDefault(v)) {
      return NextResponse.json({ error: `${k} must be one of ${ACTIVATION_GROUP_DEFAULTS.join(", ")}` }, { status: 400 });
    }
  }
  if (activationNewHireDefault !== undefined && !isActivationNewHireDefault(activationNewHireDefault)) {
    return NextResponse.json({ error: `activationNewHireDefault must be one of ${ACTIVATION_NEW_HIRE_DEFAULTS.join(", ")}` }, { status: 400 });
  }

  // Schedule column order: strict on write like the modes above (null explicitly
  // resets to the built-in default stack; reads stay lenient via parseStaffOrderCriteria).
  let columnOrder: object | null | undefined;
  if (staffColumnOrder !== undefined) {
    if (staffColumnOrder === null) {
      columnOrder = null;
    } else {
      const validated = validateStaffOrderCriteria(staffColumnOrder);
      if ("error" in validated) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      columnOrder = validated.value;
    }
  }

  // Card #301: printed header/footer templates, table font, DATE/DAY columns and pay-period
  // labels — strict on write (400 before any write); a header/footer null resets to the default.
  const printBlocks: { printHeader?: PrintBlock | null; printFooter?: PrintBlock | null } = {};
  for (const [key, v] of [["printHeader", printHeader], ["printFooter", printFooter]] as const) {
    if (v === undefined) continue;
    const r = validatePrintBlock(v);
    if (!r.ok) return NextResponse.json({ error: `${key}: ${r.error}` }, { status: 400 });
    printBlocks[key] = r.value;
  }
  if (printFontFamily !== undefined && !validatePrintFontFamily(printFontFamily)) {
    return NextResponse.json({ error: "printFontFamily must be 1–64 letters, digits, spaces or hyphens" }, { status: 400 });
  }
  if (printFontSize !== undefined && !validatePrintFontSize(printFontSize)) {
    return NextResponse.json({ error: "printFontSize must be a whole number from 6 to 14" }, { status: 400 });
  }
  for (const [key, v] of [["splitDateDayColumns", splitDateDayColumns], ["printPayPeriodLabels", printPayPeriodLabels]] as const) {
    if (v !== undefined && typeof v !== "boolean") return NextResponse.json({ error: `${key} must be true or false` }, { status: 400 });
  }
  if (dateColumnFormat !== undefined && !isDateColumnFormat(dateColumnFormat)) {
    return NextResponse.json({ error: "dateColumnFormat is not a known format" }, { status: 400 });
  }
  if (dayColumnFormat !== undefined && !isDayColumnFormat(dayColumnFormat)) {
    return NextResponse.json({ error: "dayColumnFormat is not a known format" }, { status: 400 });
  }
  // Card #299: the year export's file name template. Strict: a string that, with {YEAR}
  // filled in, is a valid file name; null clears it to the built-in default.
  let exportName: string | null | undefined;
  if (exportFileName !== undefined) {
    if (exportFileName === null) exportName = null;
    else if (typeof exportFileName !== "string") return NextResponse.json({ error: "exportFileName must be text or null" }, { status: 400 });
    else {
      const t = exportFileName.trim();
      const why = exportFileNameError(t.replaceAll("{YEAR}", "2026"));
      if (why) return NextResponse.json({ error: `exportFileName: ${why}` }, { status: 400 });
      exportName = t;
    }
  }
  const printLayoutData = {
    ...(exportName !== undefined && { exportFileName: exportName }),
    ...(printFontFamily !== undefined && { printFontFamily: printFontFamily as string }),
    ...(printFontSize !== undefined && { printFontSize: printFontSize as number }),
    ...(splitDateDayColumns !== undefined && { splitDateDayColumns: splitDateDayColumns as boolean }),
    ...(dateColumnFormat !== undefined && { dateColumnFormat: dateColumnFormat as string }),
    ...(dayColumnFormat !== undefined && { dayColumnFormat: dayColumnFormat as string }),
    ...(printPayPeriodLabels !== undefined && { printPayPeriodLabels: printPayPeriodLabels as boolean }),
  };

  // Card #300: order of the special schedule columns — strict on write, null resets to the
  // built-in order (reads stay lenient via parseSpecialColumnOrder).
  let specialOrder: string[] | null | undefined;
  if (specialColumnOrder !== undefined) {
    if (specialColumnOrder === null) {
      specialOrder = null;
    } else {
      const validated = validateSpecialColumnOrder(specialColumnOrder);
      if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
      specialOrder = validated.value;
    }
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
      ...(isApprovalConflictPolicy(approvalConflictPolicy) && { approvalConflictPolicy }),
      ...(offOrder !== undefined && { defaultOffStrategyOrder: offOrder }),
      ...(isLiveScope(defaultLiveScope) && { defaultLiveScope }),
      ...(isShiftShareBasis(shiftShareBasis) && { shiftShareBasis }),
      ...(isHolidayPolicy(holidayPolicy) && { holidayPolicy }),
      ...(isLeavePolicy(leaveHoursPolicy) && { leaveHoursPolicy }),
      ...balanceFromData,
      ...holidayShiftData,
      ...shadeData,
      ...tuningUpdate,
      ...(columnOrder !== undefined && { staffColumnOrder: columnOrder === null ? Prisma.DbNull : columnOrder }),
      ...(specialOrder !== undefined && { specialColumnOrder: specialOrder === null ? Prisma.DbNull : specialOrder }),
      ...(printBlocks.printHeader !== undefined && { printHeader: printBlocks.printHeader === null ? Prisma.DbNull : printBlocks.printHeader }),
      ...(printBlocks.printFooter !== undefined && { printFooter: printBlocks.printFooter === null ? Prisma.DbNull : printBlocks.printFooter }),
      ...printLayoutData,
      ...(isActivationGroupDefault(activationWorkedDefault) && { activationWorkedDefault }),
      ...(isActivationGroupDefault(activationNeverDefault) && { activationNeverDefault }),
      ...(isActivationNewHireDefault(activationNewHireDefault) && { activationNewHireDefault }),
    },
    create: {
      id: "default",
      prefer3DayWeekends: prefer3DayWeekends ?? true,
      prefer4DayWeekends: prefer4DayWeekends ?? true,
      preferSequentialOff: preferSequentialOff ?? true,
      ...(typeof dateFormat === "string" && isValidDateFormat(dateFormat) && { dateFormat }),
      ...(isPendingRequestMode(pendingRequestMode) && { pendingRequestMode }),
      ...(isRequestConflictPolicy(requestConflictPolicy) && { requestConflictPolicy }),
      ...(isApprovalConflictPolicy(approvalConflictPolicy) && { approvalConflictPolicy }),
      ...(offOrder !== undefined && { defaultOffStrategyOrder: offOrder }),
      ...(isLiveScope(defaultLiveScope) && { defaultLiveScope }),
      ...(isShiftShareBasis(shiftShareBasis) && { shiftShareBasis }),
      ...(isHolidayPolicy(holidayPolicy) && { holidayPolicy }),
      ...(isLeavePolicy(leaveHoursPolicy) && { leaveHoursPolicy }),
      ...balanceFromData,
      ...holidayShiftData,
      ...shadeData,
      ...tuningUpdate,
      ...(columnOrder != null && { staffColumnOrder: columnOrder }),
      ...(specialOrder != null && { specialColumnOrder: specialOrder }),
      ...(printBlocks.printHeader != null && { printHeader: printBlocks.printHeader }),
      ...(printBlocks.printFooter != null && { printFooter: printBlocks.printFooter }),
      ...printLayoutData,
      ...(isActivationGroupDefault(activationWorkedDefault) && { activationWorkedDefault }),
      ...(isActivationGroupDefault(activationNeverDefault) && { activationNeverDefault }),
      ...(isActivationNewHireDefault(activationNewHireDefault) && { activationNewHireDefault }),
    },
  });

  return NextResponse.json(prefs);
}
