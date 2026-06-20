import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

// Editable columns. PUT is a partial update — only keys actually present in the
// request body are written, so omitting a field leaves it untouched (rather than
// resetting it to a default). The Settings UI sends the full object; other
// callers can safely PATCH a subset.
const EDITABLE_FIELDS = [
  "name", "code", "defaultHours", "defaultHoursWeekend", "defaultHoursHoliday",
  "countsTowardFte", "countsAsHolidayWork",
  "isLeave", "isPaid", "category", "color", "printBackgroundColor", "sortOrder",
  "schedulePriority", "isOffShift", "isFillShift", "weekendPaired", "holidayWeekendPaired",
  "ignoresWorkingDays", "maxPerDay", "autoSchedulable", "hotkey", "dedicatedColumn",
  "boldOnSchedule",
] as const;

// Accept only null or a #rrggbb hex string for the print background; any other value
// (malformed direct-API input) is coerced to null. The settings UI only emits valid hex.
function sanitizePrintBg(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

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

  const updated = await prisma.shiftType.update({ where: { id }, data: updateData });
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
      maxPerDay: data.maxPerDay ?? null,
      autoSchedulable: data.autoSchedulable ?? false,
      hotkey: data.hotkey ?? null,
      dedicatedColumn: data.dedicatedColumn ?? false,
      boldOnSchedule: data.boldOnSchedule ?? false,
    },
  });

  const [activeStaff, employmentTypes] = await Promise.all([
    prisma.staff.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.employmentType.findMany({ select: { id: true } }),
  ]);
  const eligibilityRows = [
    ...activeStaff.map((p) => ({ staffId: p.id, shiftTypeId: created.id })),
  ];
  const defaultRows = [
    ...employmentTypes.map((et) => ({ employmentTypeId: et.id, shiftTypeId: created.id })),
  ];
  if (eligibilityRows.length > 0) {
    await prisma.staffEligibleShift.createMany({ data: eligibilityRows });
  }
  if (defaultRows.length > 0) {
    await prisma.employmentTypeDefaultShift.createMany({ data: defaultRows });
  }

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

  await prisma.shiftType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
