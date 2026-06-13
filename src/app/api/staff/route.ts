import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { provisionStaffLogin, resetLoginForStaff, deleteLoginForStaff, ensureStaffLogin } from "@/lib/user-lifecycle";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const { id, eligibleShiftTypeIds, availabilityRules, shiftEligibilityRules, shiftMinimumTargets, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.staff.update({
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

    if (data.name) {
      // Staff.name is canonical — keep the linked login's name in sync (slice 2b).
      await tx.user.updateMany({ where: { staffId: id }, data: { name: data.name } });
    }

    if (Array.isArray(eligibleShiftTypeIds)) {
      await tx.staffEligibleShift.deleteMany({ where: { staffId: id } });
      if (eligibleShiftTypeIds.length > 0) {
        await tx.staffEligibleShift.createMany({
          data: eligibleShiftTypeIds.map((stId: string) => ({
            staffId: id,
            shiftTypeId: stId,
          })),
        });
      }
    }

    if (Array.isArray(availabilityRules)) {
      await tx.availabilityRule.deleteMany({ where: { staffId: id } });
      if (availabilityRules.length > 0) {
        await tx.availabilityRule.createMany({
          data: availabilityRules.map((r: Record<string, unknown>) => ({
            staffId: id,
            dayOfWeek: r.dayOfWeek as number,
            type: (r.type as string) ?? "available",
            strength: (r.strength as string) ?? "rule",
            pattern: (r.pattern as string) ?? "every",
            cycleLength: r.cycleLength as number | undefined,
            cycleOffset: r.cycleOffset as number | undefined,
            conditionStaffId: r.conditionStaffId as string | undefined,
            conditionType: r.conditionType as string | undefined,
          })),
        });
      }
    }

    if (Array.isArray(shiftEligibilityRules)) {
      await tx.shiftEligibilityRule.deleteMany({ where: { staffId: id } });
      if (shiftEligibilityRules.length > 0) {
        await tx.shiftEligibilityRule.createMany({
          data: shiftEligibilityRules.map((r: Record<string, unknown>) => ({
            staffId: id,
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
      await tx.shiftMinimumTarget.deleteMany({ where: { staffId: id } });
      if (shiftMinimumTargets.length > 0) {
        await tx.shiftMinimumTarget.createMany({
          data: shiftMinimumTargets.map((t: Record<string, unknown>) => ({
            staffId: id,
            shiftTypeId: t.shiftTypeId as string,
            minCount: t.minCount as number,
            maxCount: (t.maxCount as number | null) ?? null,
            window: t.window as string,
            windowDays: t.windowDays as number | undefined,
          })),
        });
      }
    }
  });

  // Keep the paired login in step with the staff active-state.
  // - Deactivated → reset the login to a disabled, credential-less shell (never an
  //   admin's); the /users hide-filter drops it from the list.
  // - Otherwise (active, including reactivation) → ensure a shell login EXISTS. Normal
  //   staff already have one from create-time, but imported/seeded staff and staff that
  //   were inactive when the one-time backfill ran have none and no other way to get one;
  //   ensureStaffLogin provisions the disabled shell so it re-surfaces as "Needs setup".
  //   It does NOT enable the login — reactivation still requires a deliberate /users
  //   activation (email + password + Active toggle).
  if (data.isActive === false) {
    await resetLoginForStaff(id);
  } else {
    await ensureStaffLogin(id);
  }

  const result = await prisma.staff.findUnique({
    where: { id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true },
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("staff:edit");
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

  const maxSort = await prisma.staff.aggregate({ _max: { sortOrder: true } });
  // Create the staff member and its paired, disabled shell login atomically — the
  // "every active staff has a login" invariant (slice 2b) must not be left half-applied
  // if provisioning fails after the staff row is committed.
  const created = await prisma.$transaction(async (tx) => {
    const staff = await tx.staff.create({
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
    await provisionStaffLogin(staff.id, staff.name, tx);
    return staff;
  });

  const [defaultShifts, defaultAvailability] = await Promise.all([
    prisma.employmentTypeDefaultShift.findMany({ where: { employmentTypeId } }),
    prisma.employmentTypeDefaultAvailability.findMany({ where: { employmentTypeId } }),
  ]);
  if (defaultShifts.length > 0) {
    await prisma.staffEligibleShift.createMany({
      data: defaultShifts.map((ds) => ({
        staffId: created.id,
        shiftTypeId: ds.shiftTypeId,
      })),
    });
  }
  if (defaultAvailability.length > 0) {
    await prisma.availabilityRule.createMany({
      data: defaultAvailability.map((da) => ({
        staffId: created.id,
        dayOfWeek: da.dayOfWeek,
        type: da.type,
        strength: da.strength,
        pattern: da.pattern,
      })),
    });
  }

  const result = await prisma.staff.findUnique({
    where: { id: created.id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true },
  });

  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const assignmentCount = await prisma.assignment.count({ where: { staffId: id } });
  if (assignmentCount > 0) {
    await prisma.staff.update({ where: { id }, data: { isActive: false } });
    await resetLoginForStaff(id); // reset the paired login to a bare shell (never an admin's)
    return NextResponse.json({ ok: true, deactivated: true });
  }

  await deleteLoginForStaff(id); // before the staff delete — onDelete:SetNull would orphan the link
  await prisma.staff.delete({ where: { id } });
  return NextResponse.json({ ok: true, deleted: true });
}
