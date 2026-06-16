import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ruleToWhen, whenToColumns } from "@/lib/recurrence";
import { NextRequest, NextResponse } from "next/server";

// Derive the normalized WHEN columns for a default-availability rule on save,
// keeping them in sync with the legacy columns. ruleToWhen prefers explicit when*
// fields (slice-6c picker) and otherwise bridges the legacy dayOfWeek/pattern.
function whenColumns(r: Record<string, unknown>) {
  return whenToColumns(
    ruleToWhen({
      dayOfWeek: r.dayOfWeek as number,
      pattern: (r.pattern as string) ?? "every",
      whenKind: r.whenKind as string | null | undefined,
      whenDays: r.whenDays as number[] | null | undefined,
      whenPpWeek: r.whenPpWeek as number | null | undefined,
      whenOrds: r.whenOrds as number[] | null | undefined,
      whenCycleUnit: r.whenCycleUnit as string | null | undefined,
      whenCycleN: r.whenCycleN as number | null | undefined,
      whenCycleOffset: r.whenCycleOffset as number | null | undefined,
    }),
  );
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { id, defaultEligibleShiftTypeIds, defaultAvailabilityRules, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.employmentType.update({
    where: { id },
    data: {
      name: data.name,
      defaultIsAutoScheduled: data.defaultIsAutoScheduled,
      defaultFtePercentage: data.defaultFtePercentage,
      sortOrder: data.sortOrder,
    },
  });

  if (Array.isArray(defaultEligibleShiftTypeIds)) {
    await prisma.employmentTypeDefaultShift.deleteMany({ where: { employmentTypeId: id } });
    if (defaultEligibleShiftTypeIds.length > 0) {
      await prisma.employmentTypeDefaultShift.createMany({
        data: defaultEligibleShiftTypeIds.map((stId: string) => ({
          employmentTypeId: id,
          shiftTypeId: stId,
        })),
      });
    }
  }

  if (Array.isArray(defaultAvailabilityRules)) {
    await prisma.employmentTypeDefaultAvailability.deleteMany({ where: { employmentTypeId: id } });
    if (defaultAvailabilityRules.length > 0) {
      await prisma.employmentTypeDefaultAvailability.createMany({
        data: defaultAvailabilityRules.map((r: Record<string, unknown>) => ({
          employmentTypeId: id,
          type: (r.type as string) ?? "available",
          strength: (r.strength as string) ?? "rule",
          ...whenColumns(r),
        })),
      });
    }
  }

  const result = await prisma.employmentType.findUnique({
    where: { id },
    include: { defaultEligibleShifts: true, defaultAvailability: true },
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const data = await req.json();
  if (!data.name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const maxSort = await prisma.employmentType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.employmentType.create({
    data: {
      name: data.name,
      defaultIsAutoScheduled: data.defaultIsAutoScheduled ?? true,
      defaultFtePercentage: data.defaultFtePercentage ?? 1.0,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });

  const defaultDays = data.defaultAvailabilityRules ?? [1, 2, 3, 4, 5].map((d: number) => ({
    dayOfWeek: d, type: "available", strength: "rule", pattern: "every",
  }));
  if (defaultDays.length > 0) {
    await prisma.employmentTypeDefaultAvailability.createMany({
      data: defaultDays.map((r: Record<string, unknown>) => ({
        employmentTypeId: created.id,
        type: (r.type as string) ?? "available",
        strength: (r.strength as string) ?? "rule",
        ...whenColumns(r),
      })),
    });
  }

  const allShiftTypes = await prisma.shiftType.findMany({ select: { id: true } });
  if (allShiftTypes.length > 0) {
    await prisma.employmentTypeDefaultShift.createMany({
      data: allShiftTypes.map((st) => ({
        employmentTypeId: created.id,
        shiftTypeId: st.id,
      })),
    });
  }

  const result = await prisma.employmentType.findUnique({
    where: { id: created.id },
    include: { defaultEligibleShifts: true, defaultAvailability: true },
  });

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const staffCount = await prisma.staff.count({ where: { employmentTypeId: id } });
  if (staffCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${staffCount} staff member(s) use this type` },
      { status: 409 },
    );
  }

  await prisma.employmentType.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
