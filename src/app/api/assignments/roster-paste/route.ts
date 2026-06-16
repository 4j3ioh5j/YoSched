import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { NextRequest, NextResponse } from "next/server";

// Paste into a DEDICATED column (ICU/CARD): set each day's roster for one shift type.
// The unit is a per-date GROUP { addStaffIds, removeStaffIds }, and the server enforces
// ALL-OR-NOTHING PER GROUP authoritatively — a whole date is skipped if any involved
// cell is locked, or if applying it would clobber a different shift (a named add already
// holds another shift, or a removal target isn't actually this shift). This guarantees a
// removal can never strip holders the paste couldn't fully replace, even if the client's
// view was stale. Surviving groups apply in ONE transaction. Distinct from /paste (which
// is the staff-cell, one-shift-many-cells path) — that endpoint is untouched.

type Group = { date: string; addStaffIds: string[]; removeStaffIds: string[] };

const MAX_GROUPS = 200; // a paste spans at most a few months of one column

const asUtcDate = (date: string) => new Date(date + "T00:00:00Z");
const dateKey = (d: Date) => d.toISOString().split("T")[0];

export async function PUT(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const shiftTypeId = (body as { shiftTypeId?: unknown })?.shiftTypeId;
  const rawGroups = (body as { groups?: unknown })?.groups;
  if (typeof shiftTypeId !== "string" || !shiftTypeId || !Array.isArray(rawGroups) || rawGroups.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (rawGroups.length > MAX_GROUPS) {
    return NextResponse.json({ error: `Too many groups (max ${MAX_GROUPS})` }, { status: 413 });
  }

  const groups: Group[] = [];
  for (const g of rawGroups) {
    const date = g?.date;
    const add = g?.addStaffIds;
    const remove = g?.removeStaffIds;
    if (typeof date !== "string" || !Array.isArray(add) || !Array.isArray(remove)) {
      return NextResponse.json({ error: "Bad group" }, { status: 400 });
    }
    const addStaffIds = [...new Set(add as string[])];
    const removeStaffIds = [...new Set(remove as string[])];
    // A staff can't be both added and removed in the same date — contradictory.
    if (addStaffIds.some((id) => removeStaffIds.includes(id))) {
      return NextResponse.json({ error: "Staff in both add and remove for a date" }, { status: 400 });
    }
    groups.push({ date, addStaffIds, removeStaffIds });
  }

  const st = await prisma.shiftType.findUnique({ where: { id: shiftTypeId }, select: { id: true } });
  if (!st) return NextResponse.json({ error: "Unknown shift type" }, { status: 400 });

  // Fetch current state for every involved cell once.
  const involved = groups.flatMap((g) =>
    [...g.addStaffIds, ...g.removeStaffIds].map((staffId) => ({ staffId, date: g.date }))
  );
  const existing = involved.length
    ? await prisma.assignment.findMany({
        where: { OR: involved.map((c) => ({ staffId: c.staffId, date: asUtcDate(c.date) })) },
        select: { staffId: true, date: true, shiftTypeId: true, isLocked: true },
      })
    : [];
  const stateByKey = new Map(existing.map((e) => [`${e.staffId}:${dateKey(e.date)}`, e]));

  // Decide each group against the authoritative current state. A group survives only if
  // nothing involved is locked and applying it can't clobber a different shift.
  const survivors: { date: string; adds: string[]; removes: string[] }[] = [];
  const skippedGroups: { date: string; reason: string }[] = [];
  for (const g of groups) {
    const cur = (staffId: string) => stateByKey.get(`${staffId}:${g.date}`);
    if ([...g.addStaffIds, ...g.removeStaffIds].some((id) => cur(id)?.isLocked)) {
      skippedGroups.push({ date: g.date, reason: "locked" });
      continue;
    }
    const addConflict = g.addStaffIds.some((id) => { const e = cur(id); return e && e.shiftTypeId !== shiftTypeId; });
    const removeDrift = g.removeStaffIds.some((id) => { const e = cur(id); return !e || e.shiftTypeId !== shiftTypeId; });
    if (addConflict || removeDrift) {
      skippedGroups.push({ date: g.date, reason: "conflict" });
      continue;
    }
    survivors.push({ date: g.date, adds: g.addStaffIds, removes: g.removeStaffIds });
  }

  const applied: { id: string; staffId: string; date: string; shiftTypeId: string; isLocked: boolean; code: string; color: string }[] = [];
  const cleared: { staffId: string; date: string }[] = [];

  // All surviving groups apply together (atomic — one unexpected error rolls back every
  // accepted date, and the client treats route failure as "nothing persisted").
  if (survivors.length) {
    await prisma.$transaction(async (tx) => {
      for (const s of survivors) {
        for (const staffId of s.adds) {
          const a = await tx.assignment.upsert({
            where: { staffId_date: { staffId, date: asUtcDate(s.date) } },
            update: { shiftTypeId, source: "manual" },
            create: { staffId, date: asUtcDate(s.date), shiftTypeId, source: "manual" },
            include: { shiftType: true },
          });
          applied.push({ id: a.id, staffId: a.staffId, date: s.date, shiftTypeId: a.shiftTypeId, isLocked: a.isLocked, code: a.shiftType.code, color: a.shiftType.color ?? "#6b7280" });
        }
        for (const staffId of s.removes) {
          // Scope the delete to THIS shift (defense-in-depth; the conflict check already
          // guaranteed it) so a different shift can never be deleted.
          await tx.assignment.deleteMany({ where: { staffId, date: asUtcDate(s.date), shiftTypeId } });
          cleared.push({ staffId, date: s.date });
        }
      }
    });
  }

  // Request-approval sync over the UNION of applied + cleared. Non-fatal post-commit.
  let requestChanges: Awaited<ReturnType<typeof syncRequestApprovals>> = [];
  try {
    requestChanges = await syncRequestApprovals([...applied.map((a) => ({ staffId: a.staffId, date: a.date })), ...cleared], userId);
  } catch (err) {
    console.error("roster-paste: request-approval sync failed after commit (assignments persisted)", err);
  }

  return NextResponse.json({ applied, cleared, skippedGroups, requestChanges });
}
