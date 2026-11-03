import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { detachLoginForStaff } from "@/lib/user-lifecycle";
import { ruleToWhen, whenToColumns, standingToWhen, normalizeAnyDay } from "@/lib/recurrence";
import { NextRequest, NextResponse } from "next/server";

// Derive the normalized WHEN columns for a rule on save, keeping them in sync
// with the legacy columns. ruleToWhen prefers explicit when* fields (slice-4
// picker) and otherwise bridges the legacy dayOfWeek/pattern fields (slice-3 UI).
function whenColumns(r: Record<string, unknown>) {
  return whenToColumns(
    ruleToWhen({
      dayOfWeek: r.dayOfWeek as number,
      pattern: (r.pattern as string) ?? "every",
      cycleLength: r.cycleLength as number | null | undefined,
      cycleOffset: r.cycleOffset as number | null | undefined,
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

// StandingCommitment's legacy columns are dayOfWeek + frequency (not pattern/
// cycle*), so it needs its own WHEN derive: prefer explicit when* from the picker,
// else bridge the legacy fields. normalizeAnyDay guards non-UI clients that send
// whenKind plus an empty whenDays (an any-day rule must be kind "every", never a
// hidden ordinal/cycle). Writes only StandingCommitment's real columns.
function standingWhenColumns(r: Record<string, unknown>) {
  return whenToColumns(
    normalizeAnyDay(
      standingToWhen({
        dayOfWeek: (r.dayOfWeek as number | null) ?? null,
        frequency: (r.frequency as string) ?? "weekly",
        whenKind: r.whenKind as string | null | undefined,
        whenDays: r.whenDays as number[] | null | undefined,
        whenPpWeek: r.whenPpWeek as number | null | undefined,
        whenOrds: r.whenOrds as number[] | null | undefined,
        whenCycleUnit: r.whenCycleUnit as string | null | undefined,
        whenCycleN: r.whenCycleN as number | null | undefined,
        whenCycleOffset: r.whenCycleOffset as number | null | undefined,
      }),
    ),
  );
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const { id, eligibleShiftTypeIds, availabilityRules, shiftEligibilityRules, shiftMinimumTargets, standingCommitments, shiftOverrides, ...data } = await req.json();
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

    // Login and staff names are independent (a login "David" can be linked to staff "DH"),
    // so a staff rename no longer touches the linked login.

    // Deactivated → remove the link in the SAME transaction: a never-completed shell login
    // is deleted, a real login only loses its staffId (it keeps working; administrators
    // included). Reactivation never creates a login — logins are created on demand.
    if (data.isActive === false) {
      await detachLoginForStaff(id, tx);
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
            type: (r.type as string) ?? "available",
            strength: (r.strength as string) ?? "rule",
            conditionStaffId: r.conditionStaffId as string | undefined,
            conditionType: r.conditionType as string | undefined,
            ...whenColumns(r),
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
            type: (r.type as string) ?? "eligible",
            strength: (r.strength as string) ?? "rule",
            ...whenColumns(r),
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
            windowCount: (t.windowCount as number | undefined) ?? 1,
          })),
        });
      }
    }

    if (Array.isArray(standingCommitments)) {
      await tx.standingCommitment.deleteMany({ where: { staffId: id } });
      if (standingCommitments.length > 0) {
        await tx.standingCommitment.createMany({
          data: standingCommitments.map((r: Record<string, unknown>) => ({
            staffId: id,
            shiftTypeId: r.shiftTypeId as string,
            notes: (r.notes as string) || null,
            ...standingWhenColumns(r),
          })),
        });
      }
    }

    // Per-staff shift-hour overrides. Replace-all like the other relations. A row
    // is kept only when it actually differs from the shift's default (the client
    // sends a row per dirty shift; an all-default row is dropped here to avoid
    // accumulating no-op overrides). durationHrs is the legacy base; the day-type
    // columns are null unless explicitly split.
    if (Array.isArray(shiftOverrides)) {
      await tx.staffShiftOverride.deleteMany({ where: { staffId: id } });
      const rows = shiftOverrides
        .map((o: Record<string, unknown>) => ({
          staffId: id,
          shiftTypeId: o.shiftTypeId as string,
          durationHrs: Number(o.durationHrs),
          durationHrsWeekday: o.durationHrsWeekday == null ? null : Number(o.durationHrsWeekday),
          durationHrsWeekend: o.durationHrsWeekend == null ? null : Number(o.durationHrsWeekend),
          durationHrsHoliday: o.durationHrsHoliday == null ? null : Number(o.durationHrsHoliday),
        }))
        .filter((r) =>
          Number.isFinite(r.durationHrs) &&
          (r.durationHrsWeekday == null || Number.isFinite(r.durationHrsWeekday)) &&
          (r.durationHrsWeekend == null || Number.isFinite(r.durationHrsWeekend)) &&
          (r.durationHrsHoliday == null || Number.isFinite(r.durationHrsHoliday)),
        );
      if (rows.length > 0) {
        await tx.staffShiftOverride.createMany({ data: rows });
      }
    }
  });

  const result = await prisma.staff.findUnique({
    where: { id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true, standingCommitments: true, shiftOverrides: true },
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
  // No login is created here: logins are created on demand (the staff page's "Create
  // login" link, or /users), and linked from either side.
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
        type: da.type,
        strength: da.strength,
        // Carry the explicit WHEN columns so a default rule (e.g. an
        // ordinal/multi-day default) survives the copy to the new staff member.
        whenKind: da.whenKind,
        whenDays: da.whenDays,
        whenPpWeek: da.whenPpWeek,
        whenOrds: da.whenOrds,
        whenCycleUnit: da.whenCycleUnit,
        whenCycleN: da.whenCycleN,
        whenCycleOffset: da.whenCycleOffset,
      })),
    });
  }

  const result = await prisma.staff.findUnique({
    where: { id: created.id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true, standingCommitments: true, shiftOverrides: true },
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
    // Soft delete (history exists): deactivate + remove the login link atomically.
    await prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id }, data: { isActive: false } });
      await detachLoginForStaff(id, tx);
    });
    return NextResponse.json({ ok: true, deactivated: true });
  }

  // Hard delete: remove the link first (a shell is deleted, a real login is kept and
  // unlinked) and the staff row in one transaction.
  await prisma.$transaction(async (tx) => {
    await detachLoginForStaff(id, tx);
    await tx.staff.delete({ where: { id } });
  });
  return NextResponse.json({ ok: true, deleted: true });
}
