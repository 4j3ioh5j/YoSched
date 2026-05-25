import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { error } = await requireAuth("manager");
  if (error) return error;
  const { id, eligibleShiftTypeIds, availabilityRules, shiftEligibilityRules, shiftMinimumTargets, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.provider.update({
    where: { id },
    data: {
      name: data.name,
      initials: data.initials,
      employmentTypeId: data.employmentTypeId,
      ftePercentage: data.ftePercentage,
      specialQualifications: data.specialQualifications ?? [],
      isActive: data.isActive,
      isAutoScheduled: data.isAutoScheduled,
      sortOrder: data.sortOrder,
    },
  });

  await prisma.$transaction(async (tx) => {
    if (Array.isArray(eligibleShiftTypeIds)) {
      await tx.providerEligibleShift.deleteMany({ where: { providerId: id } });
      if (eligibleShiftTypeIds.length > 0) {
        await tx.providerEligibleShift.createMany({
          data: eligibleShiftTypeIds.map((stId: string) => ({
            providerId: id,
            shiftTypeId: stId,
          })),
        });
      }
    }

    if (Array.isArray(availabilityRules)) {
      await tx.availabilityRule.deleteMany({ where: { providerId: id } });
      if (availabilityRules.length > 0) {
        await tx.availabilityRule.createMany({
          data: availabilityRules.map((r: Record<string, unknown>) => ({
            providerId: id,
            dayOfWeek: r.dayOfWeek as number,
            type: (r.type as string) ?? "available",
            strength: (r.strength as string) ?? "rule",
            pattern: (r.pattern as string) ?? "every",
            cycleLength: r.cycleLength as number | undefined,
            cycleOffset: r.cycleOffset as number | undefined,
            conditionProviderId: r.conditionProviderId as string | undefined,
            conditionType: r.conditionType as string | undefined,
          })),
        });
      }
    }

    if (Array.isArray(shiftEligibilityRules)) {
      await tx.shiftEligibilityRule.deleteMany({ where: { providerId: id } });
      if (shiftEligibilityRules.length > 0) {
        await tx.shiftEligibilityRule.createMany({
          data: shiftEligibilityRules.map((r: Record<string, unknown>) => ({
            providerId: id,
            shiftTypeId: r.shiftTypeId as string,
            dayOfWeek: r.dayOfWeek as number,
            type: (r.type as string) ?? "eligible",
            strength: (r.strength as string) ?? "rule",
            pattern: (r.pattern as string) ?? "every",
            cycleLength: r.cycleLength as number | undefined,
            cycleOffset: r.cycleOffset as number | undefined,
          })),
        });
      }
    }

    if (Array.isArray(shiftMinimumTargets)) {
      await tx.shiftMinimumTarget.deleteMany({ where: { providerId: id } });
      if (shiftMinimumTargets.length > 0) {
        await tx.shiftMinimumTarget.createMany({
          data: shiftMinimumTargets.map((t: Record<string, unknown>) => ({
            providerId: id,
            shiftTypeId: t.shiftTypeId as string,
            minCount: t.minCount as number,
            window: t.window as string,
            windowDays: t.windowDays as number | undefined,
          })),
        });
      }
    }
  });

  const result = await prisma.provider.findUnique({
    where: { id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true },
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth("manager");
  if (error) return error;
  const data = await req.json();
  if (!data.name || !data.initials) {
    return NextResponse.json({ error: "Missing name or initials" }, { status: 400 });
  }

  let employmentTypeId = data.employmentTypeId;
  if (!employmentTypeId) {
    const defaultType = await prisma.employmentType.findFirst({ orderBy: { sortOrder: "asc" } });
    employmentTypeId = defaultType!.id;
  }

  const maxSort = await prisma.provider.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.provider.create({
    data: {
      name: data.name,
      initials: data.initials,
      employmentTypeId,
      ftePercentage: data.ftePercentage ?? 1.0,
      specialQualifications: data.specialQualifications ?? [],
      isActive: true,
      isAutoScheduled: data.isAutoScheduled ?? true,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
    include: { employmentType: true },
  });

  const [defaultShifts, defaultAvailability] = await Promise.all([
    prisma.employmentTypeDefaultShift.findMany({ where: { employmentTypeId } }),
    prisma.employmentTypeDefaultAvailability.findMany({ where: { employmentTypeId } }),
  ]);
  if (defaultShifts.length > 0) {
    await prisma.providerEligibleShift.createMany({
      data: defaultShifts.map((ds) => ({
        providerId: created.id,
        shiftTypeId: ds.shiftTypeId,
      })),
    });
  }
  if (defaultAvailability.length > 0) {
    await prisma.availabilityRule.createMany({
      data: defaultAvailability.map((da) => ({
        providerId: created.id,
        dayOfWeek: da.dayOfWeek,
        type: da.type,
        strength: da.strength,
        pattern: da.pattern,
      })),
    });
  }

  const result = await prisma.provider.findUnique({
    where: { id: created.id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true },
  });

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAuth("manager");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const assignmentCount = await prisma.assignment.count({ where: { providerId: id } });
  if (assignmentCount > 0) {
    await prisma.provider.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }

  await prisma.provider.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: true });
}
