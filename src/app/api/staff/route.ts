import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { removeStaff, detachForDeactivation, REMOVAL_TX } from "@/lib/staff-removal";
import { ruleToWhen, whenToColumns, standingToWhen, normalizeAnyDay } from "@/lib/recurrence";
import { NextRequest, NextResponse } from "next/server";
import { staffHoursWrite } from "@/lib/fte";
import { lockEligibility, eligibilityDiff, EligibilityStale } from "@/lib/eligibility-write";
import { RULE_KEYS, ruleListVersion, ruleSelect, ruleVersionsOf, lockStaffRules } from "@/lib/staff-rule-versions";
import type { RuleKey, RuleVersions } from "@/lib/staff-rule-patch";
import type { Prisma } from "@/generated/prisma/client";
import { gated } from "@/lib/write-gate";

class HoursError extends Error {}

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

type Row = Record<string, unknown>;
type RuleTable = {
  findMany(a: { where: { staffId: string }; select: Record<string, true> }): Promise<Row[]>;
  deleteMany(a: { where: { staffId: string } }): Promise<unknown>;
  createMany(a: { data: Row[] }): Promise<unknown>;
};
const RULE_TABLE: Readonly<Record<RuleKey, string>> = {
  availabilityRules: "availabilityRule",
  shiftEligibilityRules: "shiftEligibilityRule",
  shiftMinimumTargets: "shiftMinimumTarget",
  standingCommitments: "standingCommitment",
  shiftOverrides: "staffShiftOverride",
};
const ruleTable = (tx: Prisma.TransactionClient, k: RuleKey) => (tx as unknown as Record<string, RuleTable>)[RULE_TABLE[k]];


class RulesStale extends Error {
  constructor() {
    super("This person's rules were changed elsewhere (for example in another tab). Reload the page and try again.");
  }
}

/** The rows PUT writes for one sent list (without staffId), normalised exactly as stored. */
function ruleRows(k: RuleKey, list: Row[], stored: Row[]): Row[] {
  switch (k) {
    case "availabilityRules":
      return list.map((r) => ({
        type: (r.type as string) ?? "available",
        strength: (r.strength as string) ?? "rule",
        conditionStaffId: (r.conditionStaffId as string | null | undefined) ?? null,
        conditionType: (r.conditionType as string | null | undefined) ?? null,
        ...whenColumns(r),
      }));
    case "shiftEligibilityRules":
      return list.map((r) => ({
        shiftTypeId: r.shiftTypeId as string,
        type: (r.type as string) ?? "eligible",
        strength: (r.strength as string) ?? "rule",
        ...whenColumns(r),
      }));
    case "shiftMinimumTargets": {
      // Card #189: Hard ("rule") or Prefer ("preference"). A page from before the setting sends
      // no strength: it keeps the saved strength of the same target, so an old cached page can't
      // quietly turn a Prefer back into Hard. A new one is Hard.
      const keyOf = (t: Row) => `${t.shiftTypeId}|${t.window}|${(t.windowCount as number | null | undefined) ?? 1}`;
      const saved = new Map(stored.map((t) => [keyOf(t), t.strength as string]));
      const strengthOf = (t: Row): string => {
        if (!Object.prototype.hasOwnProperty.call(t, "strength") || t.strength == null) return saved.get(keyOf(t)) ?? "rule";
        if (t.strength === "rule" || t.strength === "preference") return t.strength;
        throw new TypeError("A count target must be Hard or Prefer");
      };
      return list.map((t) => ({
        shiftTypeId: t.shiftTypeId as string,
        minCount: t.minCount as number,
        maxCount: (t.maxCount as number | null) ?? null,
        window: t.window as string,
        windowDays: (t.windowDays as number | null | undefined) ?? null,
        windowCount: (t.windowCount as number | undefined) ?? 1,
        strength: strengthOf(t),
      }));
    }
    case "standingCommitments":
      return list.map((r) => ({
        shiftTypeId: r.shiftTypeId as string,
        notes: (r.notes as string) || null,
        ...standingWhenColumns(r),
      }));
    case "shiftOverrides":
      // Per-staff shift-hour overrides. durationHrs is the legacy base; the day-type columns are
      // null unless explicitly split. A row with a non-number is dropped.
      return list
        .map((o) => ({
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
  }
}

async function handlePUT(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const { id, eligibleShiftTypeIds, eligibleShiftTypeIdsBase, ruleBases, availabilityRules, shiftEligibilityRules, shiftMinimumTargets, standingCommitments, shiftOverrides, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const sentLists: Record<RuleKey, unknown> = { availabilityRules, shiftEligibilityRules, shiftMinimumTargets, standingCommitments, shiftOverrides };
  const bases: Record<string, unknown> = ruleBases && typeof ruleBases === "object" ? ruleBases : {};

  // Card #75: what the eligibility diff actually changed, returned so the page's Undo reverses
  // exactly this save and nothing made elsewhere (Codex #385).
  let applied: { add: string[]; remove: string[] } | null = null;
  // Card #206: every list's version as this transaction left it (read under the lock).
  const ruleVersions: RuleVersions = {};
  let deactivationId: string | null = null;
  try {
  await prisma.$transaction(async (tx) => {
    // Card #75: the eligibility lock first (every writer of staff_eligible_shifts takes it).
    if (Array.isArray(eligibleShiftTypeIds)) await lockEligibility(tx);
    // Card #206: then this person's rules lock, before reading what is compared.
    await lockStaffRules(tx, id);
    // Card #71: FTE % and fixed hours are decided by the (new) employment type's settings,
    // read in this transaction — a type change applies in the same write.
    const current = await tx.staff.findUnique({ where: { id }, select: { employmentTypeId: true } });
    if (!current) throw new HoursError("Staff member not found");

    // Card #206: check every sent rule list before writing anything. With a base (the version of
    // the copy the page holds) the stored list must still have it; without one (an old cached
    // page that sends every list) the list must be exactly what is stored. Otherwise the save
    // would erase rules made elsewhere → 409, nothing written.
    const writes: Partial<Record<RuleKey, Row[]>> = {};
    for (const k of RULE_KEYS) {
      const list = sentLists[k];
      if (!Array.isArray(list)) continue;
      const stored = await ruleTable(tx, k).findMany({ where: { staffId: id }, select: ruleSelect(k) });
      const rows = ruleRows(k, list as Row[], stored);
      const have = ruleListVersion(k, stored);
      if (Object.prototype.hasOwnProperty.call(bases, k)) {
        if (bases[k] !== have) throw new RulesStale();
      } else if (ruleListVersion(k, rows) !== have) {
        throw new RulesStale();
      }
      writes[k] = rows;
    }

    const typeId: string = data.employmentTypeId ?? current.employmentTypeId;
    const type = await tx.employmentType.findUnique({ where: { id: typeId } });
    if (!type) throw new HoursError("Unknown employment type");
    const hours = staffHoursWrite({
      type,
      sentFte: data.ftePercentage,
      hasFixedKey: Object.prototype.hasOwnProperty.call(data, "fixedHoursPerPp"),
      sentFixed: data.fixedHoursPerPp,
      typeChangedOrNew: typeId !== current.employmentTypeId,
    });
    if (!hours.ok) throw new HoursError(hours.error);
    await tx.staff.update({
      where: { id },
      data: {
        name: data.name,
        initials: data.initials,
        employmentTypeId: data.employmentTypeId,
        ftePercentage: hours.ftePercentage,
        fixedHoursPerPp: hours.fixedHoursPerPp,
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
    // Card #223: a real login unlinked here is recorded, so Undo can link exactly it back.
    if (data.isActive === false) {
      deactivationId = await detachForDeactivation(tx, id);
    }

    // Card #75: apply only the user's changes (against the list the page started from), so a
    // page loaded before a shift was turned on in Settings cannot revert that.
    if (Array.isArray(eligibleShiftTypeIds)) {
      const stored = (await tx.staffEligibleShift.findMany({ where: { staffId: id }, select: { shiftTypeId: true } })).map((r) => r.shiftTypeId);
      const { add, remove } = eligibilityDiff(stored, eligibleShiftTypeIds, eligibleShiftTypeIdsBase);
      applied = { add, remove };
      if (remove.length > 0) await tx.staffEligibleShift.deleteMany({ where: { staffId: id, shiftTypeId: { in: remove } } });
      if (add.length > 0) await tx.staffEligibleShift.createMany({ data: add.map((shiftTypeId) => ({ staffId: id, shiftTypeId })) });
    }

    // Replace each checked list with its normalised rows.
    for (const k of RULE_KEYS) {
      const rows = writes[k];
      if (!rows) continue;
      await ruleTable(tx, k).deleteMany({ where: { staffId: id } });
      if (rows.length > 0) await ruleTable(tx, k).createMany({ data: rows.map((r) => ({ staffId: id, ...r })) });
    }

    // Card #206 (Codex #1005): the versions are read here, under the lock, so they belong to
    // exactly what this save left — never to a later save's rows.
    for (const k of RULE_KEYS) {
      ruleVersions[k] = ruleListVersion(k, await ruleTable(tx, k).findMany({ where: { staffId: id }, select: ruleSelect(k) }));
    }
  });
  } catch (e) {
    if (e instanceof HoursError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof EligibilityStale || e instanceof RulesStale) return NextResponse.json({ error: e.message, reason: "stale" }, { status: 409 });
    if (e instanceof TypeError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const result = await prisma.staff.findUnique({
    where: { id },
    include: { employmentType: true, eligibleShifts: true, availabilityRules: true, shiftEligibilityRules: true, shiftMinimumTargets: true, standingCommitments: true, shiftOverrides: true },
  });

  return NextResponse.json({ ...result, ruleVersions, ...(applied ? { eligibleShiftTypeIdsApplied: applied } : {}), ...(deactivationId ? { deactivationId } : {}) });
}

async function handlePOST(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const data = await req.json();
  if (!data.name || !data.initials) {
    return NextResponse.json({ error: "Missing name or initials" }, { status: 400 });
  }

  const type = data.employmentTypeId
    ? await prisma.employmentType.findUnique({ where: { id: data.employmentTypeId } })
    : await prisma.employmentType.findFirst({ orderBy: { sortOrder: "asc" } });
  if (!type) return NextResponse.json({ error: "Unknown employment type" }, { status: 400 });
  const employmentTypeId = type.id;
  // Card #71: FTE % / fixed hours from the type's settings (never a hard 100% default).
  const hours = staffHoursWrite({
    type,
    sentFte: data.ftePercentage,
    hasFixedKey: Object.prototype.hasOwnProperty.call(data, "fixedHoursPerPp"),
    sentFixed: data.fixedHoursPerPp,
    typeChangedOrNew: true,
  });
  if (!hours.ok) return NextResponse.json({ error: hours.error }, { status: 400 });

  const maxSort = await prisma.staff.aggregate({ _max: { sortOrder: true } });
  // No login is created here: logins are created on demand (the staff page's "Create
  // login" link, or /users), and linked from either side.
  const created = await prisma.$transaction(async (tx) => {
    const staff = await tx.staff.create({
      data: {
        name: data.name,
        initials: data.initials,
        employmentTypeId,
        ftePercentage: hours.ftePercentage,
        fixedHoursPerPp: hours.fixedHoursPerPp ?? null,
        specialQualifications: data.specialQualifications ?? [],
        isActive: true,
        isAutoScheduled: data.isAutoScheduled ?? true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
      include: { employmentType: true },
    });
    return staff;
  });

  // Card #75: the new hire's shifts come from the type's defaults, read and copied under the
  // eligibility lock so a shift being turned on at the same moment is seen whole.
  await prisma.$transaction(async (tx) => {
    await lockEligibility(tx);
    const defaultShifts = await tx.employmentTypeDefaultShift.findMany({ where: { employmentTypeId } });
    if (defaultShifts.length > 0) {
      await tx.staffEligibleShift.createMany({
        data: defaultShifts.map((ds) => ({ staffId: created.id, shiftTypeId: ds.shiftTypeId })),
      });
    }
  });
  const defaultAvailability = await prisma.employmentTypeDefaultAvailability.findMany({ where: { employmentTypeId } });
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

  // Card #206: the new person's rule-list versions, so the page can edit their rules at once.
  return NextResponse.json(result ? { ...result, ruleVersions: ruleVersionsOf(result) } : result);
}

async function handleDELETE(req: NextRequest) {
  const { error } = await getSession("staff:edit");
  if (error) return error;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Card #220: one transaction under locks that hold off every other writer of this person's rows;
  // with assignments → deactivate (and unlink the login), else snapshot then delete (see
  // src/lib/staff-removal.ts). The snapshot lets Undo bring back the same person.
  const result = await prisma.$transaction((tx) => removeStaff(tx, id), REMOVAL_TX);
  if (result.kind === "missing") return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  if (result.kind === "deactivated") return NextResponse.json({ ok: true, deactivated: true, ...(result.deactivationId ? { deactivationId: result.deactivationId } : {}) });
  return NextResponse.json({ ok: true, deleted: true, removalId: result.removalId });
}

export const PUT = gated(handlePUT);
export const POST = gated(handlePOST);
export const DELETE = gated(handleDELETE);
