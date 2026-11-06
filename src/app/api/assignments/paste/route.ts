import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovalsAfterCommit, visibleRequestChanges } from "@/lib/request-sync";
import { resolveAutoOverride, resolveUpdaterNames } from "@/lib/assignment-attribution";
import { dayCapViolations } from "@/lib/max-per-day";
import { loadDayCaps, lockDayCaps, DAY_CAP_TX, refusalResponse } from "@/lib/day-cap-db";
import { NextRequest, NextResponse } from "next/server";

type SavedRow = { id: string; staffId: string; shiftTypeId: string; isLocked: boolean; source: string; autoMonth: string | null; autoShiftTypeId: string | null; updatedAt: Date; shiftType: { code: string; color: string | null } };

// Paste write path for the schedule grid: a block of already-resolved cells, each with
// its own shift type (unlike /bulk, which applies one shift to many cells). Applied in a
// single transaction so a paste is all-or-nothing — there is no partial-paste state for
// the client to reconcile or for undo to half-cover. Locked cells are filtered (skipped,
// not a failure). Mirrors the plain manual write semantics (upsert, source "manual").

type PasteCell = { staffId: string; date: string; shiftTypeId: string };

const MAX_CELLS = 2000; // bounds the transaction; a paste is a human-sized selection

const asUtcDate = (date: string) => new Date(date + "T00:00:00Z");

export async function PUT(req: NextRequest) {
  const { error, userId, permissions, staffId: viewerStaffId } = await getSession("schedule:edit");
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawCells = (body as { cells?: unknown })?.cells;
  if (!Array.isArray(rawCells) || rawCells.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (rawCells.length > MAX_CELLS) {
    return NextResponse.json({ error: `Too many cells (max ${MAX_CELLS})` }, { status: 413 });
  }
  for (const c of rawCells) {
    if (!c?.staffId || !c?.date || !c?.shiftTypeId) {
      return NextResponse.json({ error: "Bad cell" }, { status: 400 });
    }
  }
  const cells = rawCells as PasteCell[];

  // Reject unknown shift type ids up front — otherwise one bad id (e.g. a stale client)
  // would abort the whole transaction with an opaque FK error.
  const ids = [...new Set(cells.map((c) => c.shiftTypeId))];
  const known = await prisma.shiftType.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (known.length !== ids.length) {
    return NextResponse.json({ error: "Unknown shift type" }, { status: 400 });
  }

  // Rules for every pasted date (a superset of the unlocked cells' dates: the lookup
  // only resolves settings) and the actor's name, both before the transaction.
  const caps = await loadDayCaps(cells.map((c) => c.date));
  const actorName = userId ? (await resolveUpdaterNames([userId])).get(userId) ?? null : null;

  // Locks, cap decision and writes all run under the pasted dates' advisory locks in
  // one interactive transaction, so another writer cannot slip a row onto a date
  // between the roster read and the upserts (src/lib/day-cap-db.ts). Paste keeps its
  // SKIP semantics: an over-cap cell is dropped, never a refusal of the whole paste.
  let outcome: { saved: SavedRow[]; toApply: PasteCell[]; skippedLocked: number; skippedDayCap: number };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await lockDayCaps(tx, cells.map((c) => c.date));

      // Server is the source of truth on locks — filter locked targets out (expected, not a
      // failure), so they are never written.
      const existing = await tx.assignment.findMany({
        where: { OR: cells.map((c) => ({ staffId: c.staffId, date: asUtcDate(c.date) })) },
        select: { staffId: true, date: true, isLocked: true, source: true, shiftTypeId: true, autoShiftTypeId: true },
      });
      const lockedKeys = new Set(
        existing.filter((e) => e.isLocked).map((e) => `${e.staffId}:${e.date.toISOString().split("T")[0]}`)
      );
      // Look up the prior row per cell to capture the auto-override value (was X).
      const existingByKey = new Map(existing.map((e) => [`${e.staffId}:${e.date.toISOString().split("T")[0]}`, e]));
      const unlocked = cells.filter((c) => !lockedKeys.has(`${c.staffId}:${c.date}`));
      const skippedLocked = cells.length - unlocked.length;

      // Per-day cap: drop cells that would push a capped shift past its cap on its
      // date (counting the date's CURRENT holders of that shift plus already-accepted
      // cells in this paste). Skipped like locked cells; the client restores their prior
      // value from the reconcile. `existing` only covers the pasted cells' own keys, so
      // count the full current roster of each capped shift on the affected dates.
      const cappedIds = [...new Set(unlocked.filter((c) => caps.capOf(c.shiftTypeId, c.date) != null).map((c) => c.shiftTypeId))];
      let toApply = unlocked;
      let skippedDayCap = 0;
      if (cappedIds.length > 0) {
        const dates = [...new Set(unlocked.map((c) => c.date))].map(asUtcDate);
        const rosters = await tx.assignment.findMany({
          where: { date: { in: dates }, shiftTypeId: { in: cappedIds } },
          select: { staffId: true, date: true, shiftTypeId: true },
        });
        const current = rosters.map((r) => ({ staffId: r.staffId, date: r.date.toISOString().split("T")[0], shiftTypeId: r.shiftTypeId }));
        const violations = dayCapViolations(unlocked, current, caps.capOf);
        if (violations.length > 0) {
          const capKeys = new Set(violations.map((v) => `${v.staffId}:${v.date}`));
          toApply = unlocked.filter((c) => !capKeys.has(`${c.staffId}:${c.date}`));
          skippedDayCap = violations.length;
        }
      }

      const saved: SavedRow[] = [];
      for (const c of toApply) {
        saved.push(await tx.assignment.upsert({
          where: { staffId_date: { staffId: c.staffId, date: asUtcDate(c.date) } },
          update: { shiftTypeId: c.shiftTypeId, source: "manual", autoShiftTypeId: resolveAutoOverride(existingByKey.get(`${c.staffId}:${c.date}`) ?? null, c.shiftTypeId), updatedBy: userId },
          create: { staffId: c.staffId, date: asUtcDate(c.date), shiftTypeId: c.shiftTypeId, source: "manual", updatedBy: userId },
          include: { shiftType: true },
        }));
      }
      return { saved, toApply, skippedLocked, skippedDayCap };
    }, DAY_CAP_TX);
  } catch (e) {
    const refused = refusalResponse(e, caps);
    if (refused) return refused;
    throw e;
  }
  const { saved, toApply, skippedLocked, skippedDayCap } = outcome;

  // The assignments are already committed above. Re-syncing request approvals is a
  // derived, secondary effect — if it fails it must NOT turn a persisted paste into a
  // reported failure (the client would revert its optimistic state and skip undo while
  // the server keeps the rows, diverging the two). The helper swallows a post-commit
  // sync error and we still return `applied`; a later write/refresh re-derives approval status.
  const requestChanges = await syncRequestApprovalsAfterCommit(
    "paste",
    toApply.map((c) => ({ staffId: c.staffId, date: c.date })),
    userId
  );

  const applied = saved.map((a, i) => ({
    id: a.id,
    staffId: a.staffId,
    date: toApply[i].date,
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

  return NextResponse.json({ applied, skippedLocked, skippedDayCap, requestChanges: visibleRequestChanges(requestChanges, { permissions: permissions!, staffId: viewerStaffId ?? null }) });
}
