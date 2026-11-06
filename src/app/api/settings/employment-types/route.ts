import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ruleToWhen, whenToColumns } from "@/lib/recurrence";
import { NextRequest, NextResponse } from "next/server";
import { typeFlagsWrite } from "@/lib/fte";
import { lockEligibility, eligibilityDiff, EligibilityStale } from "@/lib/eligibility-write";

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
  const { id, defaultEligibleShiftTypeIds, defaultEligibleShiftTypeIdsBase, defaultAvailabilityRules, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Card #71: the type's settings (FTE %, fixed hours, fairness). Staff values are never touched
  // here: the resolver ignores what a setting turns off, so turning it back on (or Undo) restores it.
  let flagError: string | null;
  // Card #75: the default-shift diff actually applied, for an exact Undo (Codex #385).
  let applied: { add: string[]; remove: string[] } | null = null;
  try {
  flagError = await prisma.$transaction(async (tx) => {
    // Card #75: the eligibility lock first; the default-shift list is applied in this same
    // transaction as the user's diff, so a stale page can't overwrite a shift activation.
    if (Array.isArray(defaultEligibleShiftTypeIds)) await lockEligibility(tx);
    const existing = await tx.employmentType.findUnique({ where: { id } });
    if (!existing) return "Employment type not found";
    const w = typeFlagsWrite({ existing, body: data });
    if (!w.ok) return w.error;
    await tx.employmentType.update({
      where: { id },
      data: {
        name: data.name,
        defaultIsAutoScheduled: data.defaultIsAutoScheduled,
        defaultFtePercentage: data.defaultFtePercentage,
        sortOrder: data.sortOrder,
        ...w.flags,
      },
    });
    if (Array.isArray(defaultEligibleShiftTypeIds)) {
      const stored = (await tx.employmentTypeDefaultShift.findMany({ where: { employmentTypeId: id }, select: { shiftTypeId: true } })).map((r) => r.shiftTypeId);
      const { add, remove } = eligibilityDiff(stored, defaultEligibleShiftTypeIds, defaultEligibleShiftTypeIdsBase);
      applied = { add, remove };
      if (remove.length > 0) await tx.employmentTypeDefaultShift.deleteMany({ where: { employmentTypeId: id, shiftTypeId: { in: remove } } });
      if (add.length > 0) await tx.employmentTypeDefaultShift.createMany({ data: add.map((shiftTypeId) => ({ employmentTypeId: id, shiftTypeId })) });
    }
    return null;
  });
  } catch (e) {
    if (e instanceof EligibilityStale) return NextResponse.json({ error: e.message, reason: "stale" }, { status: 409 });
    if (e instanceof TypeError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (flagError) return NextResponse.json({ error: flagError }, { status: 400 });

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

  return NextResponse.json(applied ? { ...result, defaultEligibleShiftTypeIdsApplied: applied } : result);
}

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const data = await req.json();
  if (!data.name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  const w = typeFlagsWrite({ existing: null, body: data });
  if (!w.ok) return NextResponse.json({ error: w.error }, { status: 400 });

  const maxSort = await prisma.employmentType.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.employmentType.create({
    data: {
      name: data.name,
      defaultIsAutoScheduled: data.defaultIsAutoScheduled ?? true,
      defaultFtePercentage: data.defaultFtePercentage ?? 1.0,
      ...w.flags,
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

  // A new type starts with every shift as a default (unchanged), written under the eligibility lock.
  await prisma.$transaction(async (tx) => {
    await lockEligibility(tx);
    const allShiftTypes = await tx.shiftType.findMany({ select: { id: true } });
    if (allShiftTypes.length > 0) {
      await tx.employmentTypeDefaultShift.createMany({
        data: allShiftTypes.map((st) => ({ employmentTypeId: created.id, shiftTypeId: st.id })),
      });
    }
  });

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
