import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { coerceConditions } from "@/lib/print-column-visibility";
import { conditionsReference } from "@/lib/print-conditions";
import { lockEligibility } from "@/lib/eligibility-write";
import { SHIFT_TYPE_EDITABLE_FIELDS as EDITABLE_FIELDS, sanitizePrintBg } from "@/lib/shift-type-fields";

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { id, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updateData: Prisma.ShiftTypeUpdateInput = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in data) (updateData as Record<string, unknown>)[key] = data[key];
  }
  if ("printBackgroundColor" in updateData) {
    (updateData as Record<string, unknown>).printBackgroundColor = sanitizePrintBg(data.printBackgroundColor);
  }
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  // The per-day maximum now lives in Staffing Rules ("Max"); an old client's
  // `maxPerDay` is ignored (not in EDITABLE_FIELDS).
  //
  // Staffing Rules rows are linked to the shift's ID, so a code rename needs no
  // carry-over: the rows simply show the new code.
  const current = await prisma.shiftType.findUnique({ where: { id }, select: { id: true } });
  if (!current) return NextResponse.json({ error: "Shift type not found" }, { status: 404 });

  // Card #75: autoSchedulable is part of the activation version, so a plain save that changes it
  // takes the eligibility lock like every other writer the activation panel compares against.
  const updated = await prisma.$transaction(async (tx) => {
    if ("autoSchedulable" in updateData) await lockEligibility(tx);
    return tx.shiftType.update({ where: { id }, data: updateData });
  });
  return NextResponse.json(updated);
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const data = await req.json();
  if (!data.code || !data.name) {
    return NextResponse.json({ error: "Missing code or name" }, { status: 400 });
  }

  const maxSort = await prisma.shiftType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.shiftType.create({
    data: {
      name: data.name,
      code: data.code,
      defaultHours: data.defaultHours ?? 8,
      defaultHoursWeekend: data.defaultHoursWeekend ?? 0,
      defaultHoursHoliday: data.defaultHoursHoliday ?? 0,
      countsTowardFte: data.countsTowardFte ?? true,
      countsAsHolidayWork: data.countsAsHolidayWork ?? true,
      isLeave: data.isLeave ?? false,
      isPaid: data.isPaid ?? true,
      category: data.category ?? "work",

      color: data.color ?? "#6b7280",
      printBackgroundColor: sanitizePrintBg(data.printBackgroundColor),
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      schedulePriority: data.schedulePriority ?? null,
      isOffShift: data.isOffShift ?? false,
      isFillShift: data.isFillShift ?? false,
      weekendPaired: data.weekendPaired ?? false,
      holidayWeekendPaired: data.holidayWeekendPaired ?? false,
      ignoresWorkingDays: data.ignoresWorkingDays ?? false,
      // Card #75: always off. Turning it on goes through the activation panel, which chooses who gets
      // it (a deleted shift's Undo re-POSTs its old row; it must not come back "on" with nobody).
      autoSchedulable: false,
      hotkey: data.hotkey ?? null,
      dedicatedColumn: data.dedicatedColumn ?? false,
      boldOnSchedule: data.boldOnSchedule ?? false,
    },
  });

  // Card #75: a new shift is granted to nobody. Who may get it (and which employment types give
  // it to new hires) is chosen in the activation panel when its Auto-schedule is turned on.

  return NextResponse.json(created);
}

export async function DELETE(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const assignmentCount = await prisma.assignment.count({ where: { shiftTypeId: id } });
  if (assignmentCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${assignmentCount} assignments use this shift type` },
      { status: 409 },
    );
  }

  // Settings linked to the shift block its deletion rather than vanishing with it
  // (the FK is ON DELETE RESTRICT as the backstop for any other path).
  const staffingRows = await prisma.staffingRequirement.count({ where: { shiftTypeId: id } });
  if (staffingRows > 0) {
    const st = await prisma.shiftType.findUnique({ where: { id }, select: { code: true } });
    return NextResponse.json(
      { error: `Cannot delete: Staffing Rules has a column for ${st?.code ?? "this shift"}. Remove it there first.`, reason: "staffing-rules-linked" },
      { status: 409 },
    );
  }
  const equityRows = await prisma.equityFactor.count({ where: { shiftTypeId: id } });
  if (equityRows > 0) {
    const st = await prisma.shiftType.findUnique({ where: { id }, select: { code: true } });
    return NextResponse.json(
      { error: `Cannot delete: Equity Factors has a row for ${st?.code ?? "this shift"}. Remove it there first.`, reason: "equity-factor-linked" },
      { status: 409 },
    );
  }
  const countColumns = await prisma.countColumn.count({ where: { shiftTypeIds: { has: id } } });
  if (countColumns > 0) {
    const st = await prisma.shiftType.findUnique({ where: { id }, select: { code: true } });
    return NextResponse.json(
      { error: `Cannot delete: Count Columns has a column using ${st?.code ?? "this shift"}. Remove it there first.`, reason: "count-column-linked" },
      { status: 409 },
    );
  }
  // Printed-schedule rules/columns name shifts inside their conditions Json (few rows; scan in code).
  const [printRules, printAggregates] = await Promise.all([
    prisma.printColumnRule.findMany({ select: { conditions: true } }),
    prisma.printAggregateColumn.findMany({ select: { conditions: true } }),
  ]);
  if ([...printRules, ...printAggregates].some((r) => conditionsReference(coerceConditions(r.conditions), id))) {
    const st = await prisma.shiftType.findUnique({ where: { id }, select: { code: true } });
    return NextResponse.json(
      { error: `Cannot delete: Printed Schedule Columns has a rule using ${st?.code ?? "this shift"}. Remove it there first.`, reason: "print-column-linked" },
      { status: 409 },
    );
  }

  await prisma.shiftType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
