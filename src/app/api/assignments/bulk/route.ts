import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { parseAssignmentBase, classifyCasFailure, conflictItem, type AssignmentBase } from "@/lib/assignment-conflict";
import { NextRequest, NextResponse } from "next/server";

type BulkCell = { staffId: string; date: string; baseUpdatedAt?: string | null; force?: boolean };

type AssignmentRow = {
  id: string;
  staffId: string;
  shiftTypeId: string;
  isLocked: boolean;
  updatedAt: Date;
  shiftType: { code: string; color: string | null };
};

function fmt(a: AssignmentRow, date: string) {
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

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
}

// Parse every cell's concurrency intent up front; one malformed token fails the
// whole request with a 400 rather than silently dropping a cell.
type CheckedBase = Exclude<AssignmentBase, { kind: "invalid" }>;
function parseCells(cells: BulkCell[], batchForce: boolean): { parsed: { cell: BulkCell; base: CheckedBase }[] } | { error: string } {
  const parsed: { cell: BulkCell; base: CheckedBase }[] = [];
  for (const cell of cells) {
    const base = parseAssignmentBase(cell, { batchForce });
    if (base.kind === "invalid") return { error: `${cell.staffId}/${cell.date}: ${base.message}` };
    parsed.push({ cell, base });
  }
  return { parsed };
}

export async function PUT(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;
  const body = await req.json();
  const { cells, shiftTypeId, force } = body as { cells: BulkCell[]; shiftTypeId: string; force?: boolean };

  if (!cells?.length || !shiftTypeId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const pc = parseCells(cells, force === true);
  if ("error" in pc) return NextResponse.json({ error: pc.error }, { status: 400 });

  const applied = [];
  const skipped = [];
  const conflicts = [];

  for (const { cell, base } of pc.parsed) {
    const { staffId, date } = cell;
    const dateObj = new Date(date + "T00:00:00Z");

    if (base.kind === "legacy" || base.kind === "force") {
      const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
      if (existing?.isLocked) { skipped.push({ staffId, date, reason: "locked" }); continue; }
      const a = await prisma.assignment.upsert({
        where: { staffId_date: { staffId, date: dateObj } },
        update: { shiftTypeId, source: "manual" },
        create: { staffId, date: dateObj, shiftTypeId, source: "manual" },
        include: { shiftType: true },
      });
      applied.push(fmt(a, date));
      continue;
    }

    if (base.base === null) {
      try {
        const created = await prisma.assignment.create({ data: { staffId, date: dateObj, shiftTypeId, source: "manual" }, include: { shiftType: true } });
        applied.push(fmt(created, date));
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
        if (current?.isLocked) skipped.push({ staffId, date, reason: "locked" });
        else conflicts.push(conflictItem(staffId, date, current ? fmt(current, date) : null));
      }
      continue;
    }

    const r = await prisma.assignment.updateMany({
      where: { staffId, date: dateObj, updatedAt: base.base, isLocked: false },
      data: { shiftTypeId, source: "manual" },
    });
    if (r.count === 1) {
      const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
      applied.push(fmt(fresh!, date));
      continue;
    }
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
    if (classifyCasFailure(current) === "locked") skipped.push({ staffId, date, reason: "locked" });
    else conflicts.push(conflictItem(staffId, date, current ? fmt(current, date) : null));
  }

  await syncRequestApprovals(applied.map((r) => ({ staffId: r.staffId, date: r.date })), userId);

  return NextResponse.json({ applied, skipped, conflicts });
}

export async function DELETE(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
  if (error) return error;
  const body = await req.json();
  const { cells, force } = body as { cells: BulkCell[]; force?: boolean };

  if (!cells?.length) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const pc = parseCells(cells, force === true);
  if ("error" in pc) return NextResponse.json({ error: pc.error }, { status: 400 });

  const skipped = [];
  const conflicts = [];
  const clearedCells: { staffId: string; date: string }[] = [];

  for (const { cell, base } of pc.parsed) {
    const { staffId, date } = cell;
    const dateObj = new Date(date + "T00:00:00Z");

    if (base.kind === "legacy" || base.kind === "force") {
      const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
      if (existing?.isLocked) { skipped.push({ staffId, date, reason: "locked" }); continue; }
      await prisma.assignment.deleteMany({ where: { staffId, date: dateObj } });
      clearedCells.push({ staffId, date });
      continue;
    }

    if (base.base === null) {
      const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
      if (!current) continue; // already empty → goal met, nothing to clear
      if (current.isLocked) skipped.push({ staffId, date, reason: "locked" });
      else conflicts.push(conflictItem(staffId, date, fmt(current, date)));
      continue;
    }

    const r = await prisma.assignment.deleteMany({ where: { staffId, date: dateObj, updatedAt: base.base, isLocked: false } });
    if (r.count === 1) { clearedCells.push({ staffId, date }); continue; }
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: { shiftType: true } });
    const why = classifyCasFailure(current);
    if (why === "gone") continue; // already empty → idempotent success
    if (why === "locked") skipped.push({ staffId, date, reason: "locked" });
    else conflicts.push(conflictItem(staffId, date, current ? fmt(current, date) : null));
  }

  await syncRequestApprovals(clearedCells, userId);

  return NextResponse.json({ ok: true, cleared: clearedCells.length, skipped, conflicts });
}
