import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride, resolveUpdaterNames } from "@/lib/assignment-attribution";
import { NextRequest, NextResponse } from "next/server";

// Atomic ROSTER edit for a single dedicated column (ICU/CARD) on ONE date: set who
// holds the shift by passing the staff to add and the staff to remove. Unlike the
// inline per-cell path this used to use, the whole edit lands in ONE transaction —
// so a network failure can never leave the roster half-applied (e.g. the old holder
// deleted but the replacement never written, blanking a capped column). Distinct
// from /roster-paste (which spans MANY dates and refuses to clobber a different
// shift): here the caller has already confirmed any cross-shift replacement in the
// UI, so an add OVERWRITES whatever the target held (same semantics as a single
// PUT). Authoritative checks — locks and per-day cap — run before the transaction
// and abort the WHOLE edit (nothing persisted) on violation.

const asUtcDate = (date: string) => new Date(date + "T00:00:00Z");

export async function POST(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shiftTypeId = (body as { shiftTypeId?: unknown })?.shiftTypeId;
  const date = (body as { date?: unknown })?.date;
  const rawAdd = (body as { addStaffIds?: unknown })?.addStaffIds;
  const rawRemove = (body as { removeStaffIds?: unknown })?.removeStaffIds;
  if (typeof shiftTypeId !== "string" || !shiftTypeId || typeof date !== "string" || !date
    || !Array.isArray(rawAdd) || !Array.isArray(rawRemove)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const addStaffIds = [...new Set(rawAdd as string[])];
  const removeStaffIds = [...new Set(rawRemove as string[])];
  if (addStaffIds.some((id) => removeStaffIds.includes(id))) {
    return NextResponse.json({ error: "Staff in both add and remove" }, { status: 400 });
  }
  if (addStaffIds.length === 0 && removeStaffIds.length === 0) {
    return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
  }

  const st = await prisma.shiftType.findUnique({ where: { id: shiftTypeId }, select: { id: true, code: true, maxPerDay: true } });
  if (!st) return NextResponse.json({ error: "Unknown shift type" }, { status: 400 });

  const day = asUtcDate(date);

  // Authoritative current state: the cells we touch (for locks + auto-override) and
  // the full current roster of this shift on the date (for the cap calc).
  const [involved, holders] = await Promise.all([
    prisma.assignment.findMany({
      where: { date: day, staffId: { in: [...addStaffIds, ...removeStaffIds] } },
      select: { staffId: true, isLocked: true, shiftTypeId: true, source: true, autoShiftTypeId: true },
    }),
    prisma.assignment.findMany({ where: { date: day, shiftTypeId }, select: { staffId: true } }),
  ]);
  const involvedByStaff = new Map(involved.map((e) => [e.staffId, e]));

  // Locks are authoritative: any locked cell we'd overwrite or delete aborts the
  // whole edit (atomic — never half-apply around a lock).
  const lockedHit = [...addStaffIds, ...removeStaffIds].find((id) => involvedByStaff.get(id)?.isLocked);
  if (lockedHit) {
    return NextResponse.json({ error: "Cannot modify locked assignment", reason: "locked", staffId: lockedHit }, { status: 409 });
  }

  // Per-day cap on the RESULTING roster (current holders − removes + adds).
  if (st.maxPerDay != null) {
    const roster = new Set(holders.map((h) => h.staffId));
    for (const id of removeStaffIds) roster.delete(id);
    for (const id of addStaffIds) roster.add(id);
    if (roster.size > st.maxPerDay) {
      return NextResponse.json(
        { error: `Only ${st.maxPerDay} ${st.code} allowed per day`, reason: "day-full", code: st.code, maxPerDay: st.maxPerDay },
        { status: 409 },
      );
    }
  }

  const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;

  const saved = await prisma.$transaction(async (tx) => {
    // Removes scoped to THIS shift (defense-in-depth: never delete a different shift
    // if the caller's view drifted).
    for (const id of removeStaffIds) {
      await tx.assignment.deleteMany({ where: { staffId: id, date: day, shiftTypeId } });
    }
    const created = [];
    for (const id of addStaffIds) {
      const a = await tx.assignment.upsert({
        where: { staffId_date: { staffId: id, date: day } },
        update: { shiftTypeId, source: "manual", autoShiftTypeId: resolveAutoOverride(involvedByStaff.get(id) ?? null, shiftTypeId), updatedBy: userId },
        create: { staffId: id, date: day, shiftTypeId, source: "manual", updatedBy: userId },
        include: { shiftType: true },
      });
      created.push(a);
    }
    return created;
  });

  const applied = saved.map((a) => ({
    id: a.id,
    staffId: a.staffId,
    date,
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    code: a.shiftType.code,
    color: a.shiftType.color ?? "#6b7280",
    source: a.source,
    autoMonth: a.autoMonth,
    autoShiftTypeId: a.autoShiftTypeId,
    updatedByName: actorName,
    updatedAt: a.updatedAt.toISOString(),
  }));
  const cleared = removeStaffIds.map((staffId) => ({ staffId, date }));

  // Request-approval sync over the union of touched cells. Non-fatal post-commit
  // (the assignments are already persisted) — same rationale as the paste routes.
  let requestChanges: Awaited<ReturnType<typeof syncRequestApprovals>> = [];
  try {
    requestChanges = await syncRequestApprovals([...applied.map((a) => ({ staffId: a.staffId, date })), ...cleared], userId);
  } catch (err) {
    console.error("dedicated-entry: request-approval sync failed after commit (assignments persisted)", err);
  }

  return NextResponse.json({ applied, cleared, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
