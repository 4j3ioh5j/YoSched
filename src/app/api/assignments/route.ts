import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { parseAssignmentBase, classifyCasFailure, conflictItem } from "@/lib/assignment-conflict";
import { NextRequest, NextResponse } from "next/server";

type AssignmentRow = {
  id: string;
  staffId: string;
  shiftTypeId: string;
  isLocked: boolean;
  updatedAt: Date;
  shiftType: { code: string; color: string | null };
};

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

// Prisma unique-constraint violation (a concurrent create raced us to the cell).
function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
}

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

  // Legacy (no token) and force both use the plain upsert + upfront lock check —
  // last-write-wins, exactly as before CAS existed.
  if (parsed.kind === "legacy" || parsed.kind === "force") {
    const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
    if (existing?.isLocked) {
      return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
    }
    const assignment = await prisma.assignment.upsert({
      where: { staffId_date: { staffId, date: dateObj } },
      update: { shiftTypeId, source: "manual" },
      create: { staffId, date: dateObj, shiftTypeId, source: "manual" },
      include: { shiftType: true },
    });
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json(formatAssignment(assignment, date));
  }

  // check mode → compare-and-swap.
  if (parsed.base === null) {
    // Client saw the cell EMPTY: create, and a unique violation means someone
    // filled it underneath us.
    try {
      const created = await prisma.assignment.create({
        data: { staffId, date: dateObj, shiftTypeId, source: "manual" },
        include: { shiftType: true },
      });
      await syncRequestApprovals([{ staffId, date }], userId);
      return NextResponse.json(formatAssignment(created, date));
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
      if (current?.isLocked) return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
      return NextResponse.json({ conflict: conflictItem(staffId, date, current ? formatAssignment(current, date) : null) }, { status: 409 });
    }
  }

  // Client saw a specific assignment: only write if it still has that token and
  // isn't locked. The conditional update is atomic (row-locked) so two writers
  // with the same base cannot both win.
  const r = await prisma.assignment.updateMany({
    where: { staffId, date: dateObj, updatedAt: parsed.base, isLocked: false },
    data: { shiftTypeId, source: "manual" },
  });
  if (r.count === 1) {
    const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json(formatAssignment(fresh!, date));
  }
  const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
  if (classifyCasFailure(current) === "locked") return NextResponse.json({ error: "Cannot modify locked assignment" }, { status: 400 });
  // gone (deleted underneath) or changed → both are conflicts for an update.
  return NextResponse.json({ conflict: conflictItem(staffId, date, current ? formatAssignment(current, date) : null) }, { status: 409 });
}

// Thrown inside the swap transaction when a CAS-guarded side no longer matches its
// base token, to roll the whole swap back.
class SwapConflict extends Error {
  constructor(public conflicts: ReturnType<typeof conflictItem<ReturnType<typeof formatAssignment>>>[]) {
    super("swap conflict");
  }
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
    prisma.assignment.findUnique({ where: { staffId_date: { staffId: from.staffId, date: fromDate } }, include: { shiftType: true } }),
    prisma.assignment.findUnique({ where: { staffId_date: { staffId: to.staffId, date: toDate } }, include: { shiftType: true } }),
  ]);

  if (!fromAssignment) {
    return NextResponse.json({ error: "Source assignment not found" }, { status: 404 });
  }
  if (fromAssignment.isLocked || toAssignment?.isLocked) {
    return NextResponse.json({ error: "Cannot move locked assignments" }, { status: 400 });
  }

  // Pre-flight conflict check (gives a clean 409 + current values); the conditional
  // deletes inside the transaction are what actually enforce atomicity.
  const preConflicts: ReturnType<typeof conflictItem<ReturnType<typeof formatAssignment>>>[] = [];
  if (fromBase.kind === "check" && fromBase.base !== null && fromAssignment.updatedAt.getTime() !== fromBase.base.getTime()) {
    preConflicts.push(conflictItem(from.staffId, from.date, formatAssignment(fromAssignment, from.date)));
  }
  if (toBase.kind === "check") {
    if (toBase.base === null && toAssignment) {
      preConflicts.push(conflictItem(to.staffId, to.date, formatAssignment(toAssignment, to.date)));
    } else if (toBase.base !== null && (!toAssignment || toAssignment.updatedAt.getTime() !== toBase.base.getTime())) {
      preConflicts.push(conflictItem(to.staffId, to.date, toAssignment ? formatAssignment(toAssignment, to.date) : null));
    }
  }
  if (preConflicts.length > 0) {
    return NextResponse.json({ conflicts: preConflicts }, { status: 409 });
  }

  // A CAS-guarded delete: when the side opted into checking against a token, delete
  // conditionally on (id + that token) so a concurrent change makes it match 0 rows.
  async function casDelete(
    tx: Prisma.TransactionClient,
    id: string,
    base: typeof fromBase,
    staffId: string,
    date: string,
    conflictCurrent: ReturnType<typeof formatAssignment>,
  ) {
    if (base.kind === "check" && base.base !== null) {
      const res = await tx.assignment.deleteMany({ where: { id, updatedAt: base.base, isLocked: false } });
      if (res.count !== 1) throw new SwapConflict([conflictItem(staffId, date, conflictCurrent)]);
    } else {
      await tx.assignment.delete({ where: { id } });
    }
  }

  try {
    const results: Record<string, unknown> = {};

    if (toAssignment) {
      const [newFrom, newTo] = await prisma.$transaction(async (tx) => {
        await casDelete(tx, fromAssignment.id, fromBase, from.staffId, from.date, formatAssignment(fromAssignment, from.date));
        await casDelete(tx, toAssignment.id, toBase, to.staffId, to.date, formatAssignment(toAssignment, to.date));
        return Promise.all([
          tx.assignment.create({ data: { staffId: to.staffId, date: toDate, shiftTypeId: fromAssignment.shiftTypeId, source: "manual" }, include: { shiftType: true } }),
          tx.assignment.create({ data: { staffId: from.staffId, date: fromDate, shiftTypeId: toAssignment.shiftTypeId, source: "manual" }, include: { shiftType: true } }),
        ]);
      });
      results.moved = formatAssignment(newFrom, to.date);
      results.swapped = formatAssignment(newTo, from.date);
    } else {
      const newAssignment = await prisma.$transaction(async (tx) => {
        await casDelete(tx, fromAssignment.id, fromBase, from.staffId, from.date, formatAssignment(fromAssignment, from.date));
        return tx.assignment.create({ data: { staffId: to.staffId, date: toDate, shiftTypeId: fromAssignment.shiftTypeId, source: "manual" }, include: { shiftType: true } });
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
    if (e instanceof SwapConflict) return NextResponse.json({ conflicts: e.conflicts }, { status: 409 });
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

  // Legacy/force: clear the cell as before (lock still blocks).
  if (parsed.kind === "legacy" || parsed.kind === "force") {
    const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
    if (existing?.isLocked) {
      return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
    }
    await prisma.assignment.deleteMany({ where: { staffId, date: dateObj } });
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json({ ok: true });
  }

  if (parsed.base === null) {
    // Client believed the cell was empty. If it still is, success (goal met); if
    // something appeared underneath, that's a conflict — don't silently wipe it.
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
    if (!current) return NextResponse.json({ ok: true });
    if (current.isLocked) return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
    return NextResponse.json({ conflict: conflictItem(staffId, date, formatAssignment(current, date)) }, { status: 409 });
  }

  // Conditional delete on the seen token. Atomic: a concurrent change makes it
  // match 0 rows.
  const r = await prisma.assignment.deleteMany({ where: { staffId, date: dateObj, updatedAt: parsed.base, isLocked: false } });
  if (r.count === 1) {
    await syncRequestApprovals([{ staffId, date }], userId);
    return NextResponse.json({ ok: true });
  }
  const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
  const why = classifyCasFailure(current);
  if (why === "gone") return NextResponse.json({ ok: true }); // already empty → idempotent success
  if (why === "locked") return NextResponse.json({ error: "Cannot delete locked assignment" }, { status: 400 });
  return NextResponse.json({ conflict: conflictItem(staffId, date, formatAssignment(current!, date)) }, { status: 409 });
}
