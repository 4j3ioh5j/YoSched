import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { deriveCountColumnCodes } from "@/lib/count-columns";
import { STALE_CLIENT } from "@/lib/stale-client";

// Count columns, linked to the shifts' IDs. The list IS the setting: the body replaces all
// rows. Every shift reference must be a current shift id and the body must carry no shift
// code at all — this path exists so that a save from a new tab can never be interpreted by
// a server that still resolves codes (a pre-slice server has no such route and answers 404).
type ColumnIn = { label?: unknown; shiftTypeIds?: unknown; shiftCodes?: unknown; sortOrder?: unknown };

function bad(error: string, reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, reason, ...extra }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const body = (await req.json()) as { columns?: unknown };
  if (!Array.isArray(body?.columns)) return bad("columns must be an array", "bad-request");
  const columns = body.columns as ColumnIn[];

  const shiftTypes = await prisma.shiftType.findMany({ select: { id: true, code: true } });
  const currentIds = new Set(shiftTypes.map((s) => s.id));
  const currentCodes = new Set(shiftTypes.map((s) => s.code));

  // Validate everything before any write.
  const rows: { label: string; shiftTypeIds: string[]; sortOrder: number }[] = [];
  for (const [i, c] of columns.entries()) {
    if (!c || typeof c !== "object") return bad(`column ${i}: not an object`, "bad-request");
    if ("shiftCodes" in c) return bad(`column ${i}: shiftCodes is not accepted here; send shiftTypeIds`, "bad-request");
    if (typeof c.label !== "string" || !c.label.trim()) return bad(`column ${i}: label required`, "bad-request");
    if (!Array.isArray(c.shiftTypeIds)) return bad(`column ${i}: shiftTypeIds must be an array`, "bad-request");
    const seen = new Set<string>();
    for (const id of c.shiftTypeIds) {
      if (typeof id !== "string" || !id) return bad(`column ${i}: shiftTypeIds must be strings`, "bad-request");
      if (!currentIds.has(id)) {
        // A current CODE where an id belongs is a tab from before the id link.
        if (currentCodes.has(id)) return NextResponse.json(STALE_CLIENT, { status: 409 });
        return bad(`Unknown shift ${id}`, "unknown-shift", { shiftTypeId: id });
      }
      if (seen.has(id)) return bad(`column ${i}: shift listed twice`, "duplicate", { shiftTypeId: id });
      seen.add(id);
    }
    const sortOrder = typeof c.sortOrder === "number" && Number.isInteger(c.sortOrder) ? c.sortOrder : i;
    rows.push({ label: c.label, shiftTypeIds: c.shiftTypeIds as string[], sortOrder });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.countColumn.deleteMany({});
    if (rows.length > 0) await tx.countColumn.createMany({ data: rows });
    return tx.countColumn.findMany({ orderBy: { sortOrder: "asc" } });
  });

  return NextResponse.json(deriveCountColumnCodes(result, shiftTypes));
}
