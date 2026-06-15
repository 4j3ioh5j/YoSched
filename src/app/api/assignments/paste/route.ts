import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { syncRequestApprovals } from "@/lib/request-sync";
import { NextRequest, NextResponse } from "next/server";

// Paste write path for the schedule grid: a block of already-resolved cells, each with
// its own shift type (unlike /bulk, which applies one shift to many cells). Applied in a
// single transaction so a paste is all-or-nothing — there is no partial-paste state for
// the client to reconcile or for undo to half-cover. Locked cells are filtered (skipped,
// not a failure). Mirrors the plain manual write semantics (upsert, source "manual").

type PasteCell = { staffId: string; date: string; shiftTypeId: string };

const MAX_CELLS = 2000; // bounds the transaction; a paste is a human-sized selection

const asUtcDate = (date: string) => new Date(date + "T00:00:00Z");

export async function PUT(req: NextRequest) {
  const { error, userId } = await getSession("schedule:edit");
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

  // Server is the source of truth on locks — filter locked targets out (expected, not a
  // failure), so they never enter the transaction.
  const existing = await prisma.assignment.findMany({
    where: { OR: cells.map((c) => ({ staffId: c.staffId, date: asUtcDate(c.date) })) },
    select: { staffId: true, date: true, isLocked: true },
  });
  const lockedKeys = new Set(
    existing.filter((e) => e.isLocked).map((e) => `${e.staffId}:${e.date.toISOString().split("T")[0]}`)
  );
  const toApply = cells.filter((c) => !lockedKeys.has(`${c.staffId}:${c.date}`));
  const skippedLocked = cells.length - toApply.length;

  const saved = toApply.length
    ? await prisma.$transaction(
        toApply.map((c) =>
          prisma.assignment.upsert({
            where: { staffId_date: { staffId: c.staffId, date: asUtcDate(c.date) } },
            update: { shiftTypeId: c.shiftTypeId, source: "manual" },
            create: { staffId: c.staffId, date: asUtcDate(c.date), shiftTypeId: c.shiftTypeId, source: "manual" },
            include: { shiftType: true },
          })
        )
      )
    : [];

  // The assignments are already committed above. Re-syncing request approvals is a
  // derived, secondary effect — if it fails it must NOT turn a persisted paste into a
  // reported failure (the client would revert its optimistic state and skip undo while
  // the server keeps the rows, diverging the two). So swallow a post-commit sync error
  // and still return `applied`; a later write/refresh re-derives approval status.
  try {
    await syncRequestApprovals(
      toApply.map((c) => ({ staffId: c.staffId, date: c.date })),
      userId
    );
  } catch (err) {
    console.error("paste: request-approval sync failed after commit (assignments persisted)", err);
  }

  const applied = saved.map((a, i) => ({
    id: a.id,
    staffId: a.staffId,
    date: toApply[i].date,
    shiftTypeId: a.shiftTypeId,
    isLocked: a.isLocked,
    code: a.shiftType.code,
    color: a.shiftType.color ?? "#6b7280",
  }));

  return NextResponse.json({ applied, skippedLocked });
}
