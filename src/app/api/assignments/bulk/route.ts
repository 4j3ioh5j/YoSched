import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { parseAssignmentBase, classifyCasFailure, conflictItem, type AssignmentBase } from "@/lib/assignment-conflict";
import { resolveUpdaterNames, updaterName } from "@/lib/assignment-attribution";
import { NextRequest, NextResponse } from "next/server";

type BulkCell = { staffId: string; date: string; baseUpdatedAt?: string | null; force?: boolean };

type AssignmentRow = {
  id: string;
  staffId: string;
  shiftTypeId: string;
  isLocked: boolean;
  updatedAt: Date;
  updatedBy: string | null;
  shiftType: { code: string; color: string | null };
};

// Normal shape — updatedAt only, never updatedBy (CR #676).
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

const incl = { shiftType: true } as const;

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

  const write = { shiftTypeId, source: "manual", updatedBy: userId };
  const applied = [];
  const skipped = [];
  const conflictRows: { staffId: string; date: string; row: AssignmentRow | null }[] = [];

  for (const { cell, base } of pc.parsed) {
    const { staffId, date } = cell;
    const dateObj = new Date(date + "T00:00:00Z");

    if (base.kind === "legacy") {
      const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
      if (existing?.isLocked) { skipped.push({ staffId, date, reason: "locked" }); continue; }
      const a = await prisma.assignment.upsert({ where: { staffId_date: { staffId, date: dateObj } }, update: write, create: { staffId, date: dateObj, ...write }, include: incl });
      applied.push(fmt(a, date));
      continue;
    }

    if (base.kind === "force") {
      // Atomic-on-lock overwrite (CR #676 force-only).
      const upd = await prisma.assignment.updateMany({ where: { staffId, date: dateObj, isLocked: false }, data: write });
      if (upd.count === 1) {
        const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
        applied.push(fmt(fresh!, date));
        continue;
      }
      const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
      if (current) { skipped.push({ staffId, date, reason: "locked" }); continue; }
      try {
        const created = await prisma.assignment.create({ data: { staffId, date: dateObj, ...write }, include: incl });
        applied.push(fmt(created, date));
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const upd2 = await prisma.assignment.updateMany({ where: { staffId, date: dateObj, isLocked: false }, data: write });
        if (upd2.count !== 1) { skipped.push({ staffId, date, reason: "locked" }); continue; }
        const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
        applied.push(fmt(fresh!, date));
      }
      continue;
    }

    if (base.base === null) {
      try {
        const created = await prisma.assignment.create({ data: { staffId, date: dateObj, ...write }, include: incl });
        applied.push(fmt(created, date));
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
        if (current?.isLocked) skipped.push({ staffId, date, reason: "locked" });
        else conflictRows.push({ staffId, date, row: current });
      }
      continue;
    }

    const r = await prisma.assignment.updateMany({ where: { staffId, date: dateObj, updatedAt: base.base, isLocked: false }, data: write });
    if (r.count === 1) {
      const fresh = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
      applied.push(fmt(fresh!, date));
      continue;
    }
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
    if (classifyCasFailure(current) === "locked") skipped.push({ staffId, date, reason: "locked" });
    else conflictRows.push({ staffId, date, row: current });
  }

  await syncRequestApprovals(applied.map((r) => ({ staffId: r.staffId, date: r.date })), userId);

  const names = await resolveUpdaterNames(conflictRows.map((c) => c.row?.updatedBy));
  const conflicts = conflictRows.map((c) => conflictItem(c.staffId, c.date, c.row ? { ...fmt(c.row, c.date), updatedByName: updaterName(c.row.updatedBy, names) } : null));

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
  const conflictRows: { staffId: string; date: string; row: AssignmentRow | null }[] = [];
  const clearedCells: { staffId: string; date: string }[] = [];

  for (const { cell, base } of pc.parsed) {
    const { staffId, date } = cell;
    const dateObj = new Date(date + "T00:00:00Z");

    if (base.kind === "legacy") {
      const existing = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
      if (existing?.isLocked) { skipped.push({ staffId, date, reason: "locked" }); continue; }
      await prisma.assignment.deleteMany({ where: { staffId, date: dateObj } });
      clearedCells.push({ staffId, date });
      continue;
    }

    if (base.kind === "force") {
      const del = await prisma.assignment.deleteMany({ where: { staffId, date: dateObj, isLocked: false } });
      if (del.count === 1) { clearedCells.push({ staffId, date }); continue; }
      const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } } });
      if (current) skipped.push({ staffId, date, reason: "locked" });
      // else already empty → no-op
      continue;
    }

    if (base.base === null) {
      const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
      if (!current) continue; // already empty → goal met
      if (current.isLocked) skipped.push({ staffId, date, reason: "locked" });
      else conflictRows.push({ staffId, date, row: current });
      continue;
    }

    const r = await prisma.assignment.deleteMany({ where: { staffId, date: dateObj, updatedAt: base.base, isLocked: false } });
    if (r.count === 1) { clearedCells.push({ staffId, date }); continue; }
    const current = await prisma.assignment.findUnique({ where: { staffId_date: { staffId, date: dateObj } }, include: incl });
    const why = classifyCasFailure(current);
    if (why === "gone") continue; // already empty → idempotent success
    if (why === "locked") skipped.push({ staffId, date, reason: "locked" });
    else conflictRows.push({ staffId, date, row: current });
  }

  await syncRequestApprovals(clearedCells, userId);

  const names = await resolveUpdaterNames(conflictRows.map((c) => c.row?.updatedBy));
  const conflicts = conflictRows.map((c) => conflictItem(c.staffId, c.date, c.row ? { ...fmt(c.row, c.date), updatedByName: updaterName(c.row.updatedBy, names) } : null));

  return NextResponse.json({ ok: true, cleared: clearedCells.length, skipped, conflicts });
}
