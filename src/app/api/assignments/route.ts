import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { parseAssignmentBase, classifyCasFailure, conflictItem } from "@/lib/assignment-conflict";
import { resolveUpdaterNames, updaterName } from "@/lib/assignment-attribution";
import { NextRequest, NextResponse } from "next/server";

type AssignmentRow = {
  id: string;
  staffId: string;
  shiftTypeId: string;
  isLocked: boolean;
  updatedAt: Date;
  updatedBy: string | null;
  shiftType: { code: string; color: string | null };
};

// Normal response shape — updatedAt only. `updatedBy` is NEVER exposed here; it is
// resolved to a name solely inside conflict payloads (CR #676).
function formatAssignment(a: AssignmentRow, date: string) {
  return {
    id: a.id,
    staffId: a.staffId,
    date,
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    updatedAt: a.updatedAt.toISOString(),
    code: a.shiftType.code,
    color: a.shiftType.color ?? "#6b7280",
  };
}

// Conflict-only shape: the normal value plus the resolved updater name.
function conflictCurrent(a: AssignmentRow, date: string, names: Map<string, string>) {
  return { ...formatAssignment(a, date), updatedByName: updaterName(a.updatedBy, names) };
}

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
}

const incl = { shiftType: true } as const;

export async function PUT(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;
  const body = await req.json();
  const { staffId, date, shiftTypeId } = body;

  if (!staffId || !date || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const parsed = parseAssignmentBase(body);
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.message }, { status: 400 });
  const dateObj = new Date(date + "T00:00:00Z");
  const write = { shiftTypeId, source: "manual", updatedBy: userId };

  // Legacy (no token): unchanged last-write-wins with an upfront lock check.
  if (parsed.kind === "legacy") {
    const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
    if (existing?.isLocked) return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
    const assignment = await prisma.assignment.upsert({
      where: { staffId_date: { staffId, date: dateObj } },
      update: write,
      create: { staffId, date: dateObj, ...write },
      include: incl,
    });
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json(formatAssignment(assignment, date));
  }

  // Force: overwrite regardless of conflict, but the lock is enforced ATOMICALLY
  // (CR #676 — force-only) via the conditional update predicate.
  if (parsed.kind === "force") {
    const upd = await prisma.assignment.updateMany({ where: { staffId, date: dateObj, isLocked: false }, data: write });
    if (upd.count === 1) {
      const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
      await syncRequestApprovals([{ staffId, date }], userId);
      return NextResponse.json(formatAssignment(fresh!, date));
    }
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
    if (current) return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 }); // existed but skipped ⇒ locked
    try {
      const created = await prisma.assignment.create({ data: { staffId, date: dateObj, ...write }, include: incl });
      await syncRequestApprovals([{ staffId, date }], userId);
      return NextResponse.json(formatAssignment(created, date));
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // created in the gap → re-apply the force update unless it is now locked
      const upd2 = await prisma.assignment.updateMany({ where: { staffId, date: dateObj, isLocked: false }, data: write });
      if (upd2.count !== 1) return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
      const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
      await syncRequestApprovals([{ staffId, date }], userId);
      return NextResponse.json(formatAssignment(fresh!, date));
    }
  }

  // check mode → compare-and-swap.
  if (parsed.base === null) {
    // Client saw the cell EMPTY: a unique violation means it was filled underneath.
    try {
      const created = await prisma.assignment.create({ data: { staffId, date: dateObj, ...write }, include: incl });
      await syncRequestApprovals([{ staffId, date }], userId);
      return NextResponse.json(formatAssignment(created, date));
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
      if (current?.isLocked) return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
      const names = await resolveUpdaterNames([current?.updatedBy]);
      return NextResponse.json({ conflict: conflictItem(staffId, date, current ? conflictCurrent(current, date, names) : null) }, { status: 409 });
    }
  }

  // Client saw a specific assignment: write only if it still has that token and
  // isn't locked. The conditional update is atomic, so two same-base writers can't
  // both win.
  const r = await prisma.assignment.updateMany({ where: { staffId, date: dateObj, updatedAt: parsed.base, isLocked: false }, data: write });
  if (r.count === 1) {
    const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json(formatAssignment(fresh!, date));
  }
  const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
  if (classifyCasFailure(current) === "locked") return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
  const names = await resolveUpdaterNames([current?.updatedBy]);
  return NextResponse.json({ conflict: conflictItem(staffId, date, current ? conflictCurrent(current, date, names) : null) }, { status: 409 });
}

// Thrown inside the swap transaction when a CAS-guarded side no longer matches its
// base token, to roll the whole swap back. Carries raw rows; names resolve after.
class SwapConflict extends Error {
  constructor(public cells: { staffId: string; date: string }[]) {
    super("swap conflict");
  }
}

// Build a swap 409 by RELOADING each cell's CURRENT row (CR #680) so the payload
// reflects DB truth at response time — never a stale pre-flight snapshot.
async function swap409(cells: { staffId: string; date: string }[]) {
  const rows = await Promise.all(
    cells.map((c) => prisma.assignment.findUnique({ where: { staffId_date: { staffId: c.staffId, date: new Date(c.date + "T00:00:00Z") } }, include: incl })),
  );
  const names = await resolveUpdaterNames(rows.map((r) => r?.updatedBy));
  return NextResponse.json(
    { conflicts: cells.map((c, i) => conflictItem(c.staffId, c.date, rows[i] ? conflictCurrent(rows[i]!, c.date, names) : null)) },
    { status: 409 },
  );
}

export async function POST(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;
  const body = await req.json();
  const { action, from, to } = body;

  if (action !== "swap" || !from || !to) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const fromBase = parseAssignmentBase(from, { batchForce: body.force === true });
  const toBase = parseAssignmentBase(to, { batchForce: body.force === true });
  if (fromBase.kind === "invalid") return NextResponse.json({ error: `from: ${fromBase.message}` }, { status: 400 });
  if (toBase.kind === "invalid") return NextResponse.json({ error: `to: ${toBase.message}` }, { status: 400 });

  const fromDate = new Date(from.date + "T00:00:00Z");
  const toDate = new Date(to.date + "T00:00:00Z");

  const [fromAssignment, toAssignment] = await Promise.all([
    prisma.assignment.findUnique({ where: { staffId_date: { staffId: from.staffId, date: fromDate } }, include: incl }),
    prisma.assignment.findUnique({ where: { staffId_date: { staffId: to.staffId, date: toDate } }, include: incl }),
  ]);

  if (!fromAssignment) {
    return NextResponse.json({ error: "Source assignment not found" }, { status: 404 });
  }
  if (fromAssignment.isLocked || toAssignment?.isLocked) {
    return NextResponse.json({ error: "Cannot move locked assignments" }, { status: 400 });
  }

  // Pre-flight conflict check (fast path); swap409 reloads the live rows so the
  // payload is accurate. The conditional deletes inside the transaction enforce
  // the actual atomicity.
  const pre: { staffId: string; date: string }[] = [];
  if (fromBase.kind === "check" && fromBase.base !== null && fromAssignment.updatedAt.getTime() !== fromBase.base.getTime()) {
    pre.push({ staffId: from.staffId, date: from.date });
  }
  if (toBase.kind === "check") {
    if (toBase.base === null && toAssignment) pre.push({ staffId: to.staffId, date: to.date });
    else if (toBase.base !== null && (!toAssignment || toAssignment.updatedAt.getTime() !== toBase.base.getTime()))
      pre.push({ staffId: to.staffId, date: to.date });
  }
  if (pre.length > 0) return swap409(pre);

  async function casDelete(tx: Prisma.TransactionClient, id: string, base: typeof fromBase, staffId: string, date: string) {
    // Every path keeps isLocked:false in the delete predicate so the swap is atomic
    // on locks — a cell locked after the pre-check (CR #678) can't be moved/cleared.
    // check-mode also pins updatedAt so a concurrent change rolls the swap back.
    // count !== 1 ⇒ locked/changed/vanished since pre-flight → 409 (swap409 reloads).
    const where = base.kind === "check" && base.base !== null ? { id, updatedAt: base.base, isLocked: false } : { id, isLocked: false };
    const res = await tx.assignment.deleteMany({ where });
    if (res.count !== 1) throw new SwapConflict([{ staffId, date }]);
  }

  try {
    const results: Record<string, unknown> = {};
    if (toAssignment) {
      const [newFrom, newTo] = await prisma.$transaction(async (tx) => {
        await casDelete(tx, fromAssignment.id, fromBase, from.staffId, from.date);
        await casDelete(tx, toAssignment.id, toBase, to.staffId, to.date);
        return Promise.all([
          tx.assignment.create({ data: { staffId: to.staffId, date: toDate, shiftTypeId: fromAssignment.shiftTypeId, source: "manual", updatedBy: userId }, include: incl }),
          tx.assignment.create({ data: { staffId: from.staffId, date: fromDate, shiftTypeId: toAssignment.shiftTypeId, source: "manual", updatedBy: userId }, include: incl }),
        ]);
      });
      results.moved = formatAssignment(newFrom, to.date);
      results.swapped = formatAssignment(newTo, from.date);
    } else {
      const newAssignment = await prisma.$transaction(async (tx) => {
        await casDelete(tx, fromAssignment.id, fromBase, from.staffId, from.date);
        return tx.assignment.create({ data: { staffId: to.staffId, date: toDate, shiftTypeId: fromAssignment.shiftTypeId, source: "manual", updatedBy: userId }, include: incl });
      });
      results.moved = formatAssignment(newAssignment, to.date);
      results.cleared = { staffId: from.staffId, date: from.date };
    }

    await syncRequestApprovals(
      [
        { staffId: from.staffId, date: from.date },
        { staffId: to.staffId, date: to.date },
      ],
      userId,
    );
    return NextResponse.json(results);
  } catch (e) {
    if (e instanceof SwapConflict) return swap409(e.cells);
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;
  const body = await req.json();
  const { staffId, date } = body;

  if (!staffId || !date) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const parsed = parseAssignmentBase(body);
  if (parsed.kind === "invalid") return NextResponse.json({ error: parsed.message }, { status: 400 });
  const dateObj = new Date(date + "T00:00:00Z");

  // Legacy: clear as before (lock pre-check).
  if (parsed.kind === "legacy") {
    const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
    if (existing?.isLocked) return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
    await prisma.assignment.deleteMany({ where: { staffId, date: dateObj } });
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json({ ok: true });
  }

  // Force: delete unless locked, atomically (CR #676 — force-only).
  if (parsed.kind === "force") {
    const del = await prisma.assignment.deleteMany({ where: { staffId, date: dateObj, isLocked: false } });
    if (del.count === 1) {
      await syncRequestApprovals([{ staffId, date }], userId);
      return NextResponse.json({ ok: true });
    }
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
    if (current) return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
    return NextResponse.json({ ok: true }); // already empty
  }

  if (parsed.base === null) {
    // Client believed empty: success if still empty, conflict if something appeared.
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
    if (!current) return NextResponse.json({ ok: true });
    if (current.isLocked) return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
    const names = await resolveUpdaterNames([current.updatedBy]);
    return NextResponse.json({ conflict: conflictItem(staffId, date, conflictCurrent(current, date, names)) }, { status: 409 });
  }

  const r = await prisma.assignment.deleteMany({ where: { staffId, date: dateObj, updatedAt: parsed.base, isLocked: false } });
  if (r.count === 1) {
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json({ ok: true });
  }
  const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
  const why = classifyCasFailure(current);
  if (why === "gone") return NextResponse.json({ ok: true }); // already empty → idempotent success
  if (why === "locked") return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
  const names = await resolveUpdaterNames([current!.updatedBy]);
  return NextResponse.json({ conflict: conflictItem(staffId, date, conflictCurrent(current!, date, names)) }, { status: 409 });
}
