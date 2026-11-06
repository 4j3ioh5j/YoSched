import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type ReqIn = { shiftTypeId?: unknown; shiftCode?: unknown; dayKey?: unknown; minCount?: unknown; preferredCount?: unknown; maxCount?: unknown };

const STALE_CLIENT = {
  error: "Settings have changed since this page was loaded — reload the page and try again.",
  reason: "stale-client",
};

// Staffing Rules: Min / Preferred / Max per shift × day ("0".."6", "holiday"), linked to
// the shift's ID — renaming a shift's code changes nothing here.
//  - Every shift reference in the body (requirements[].shiftTypeId, columns[], removedColumns[])
//    must be a CURRENT shift id. The server never turns a code into an id: after a rename
//    and a reuse of the old code, a code could name the wrong shift. A body that names
//    shifts by code (a tab opened before this version) gets 409 stale-client before any
//    write; any other unknown reference gets 400 unknown-shift.
//  - maxCount: null = no limit; omitted = keep the stored value (an older client that
//    doesn't know the Max column never wipes it).
//  - Columns are deleted ONLY when named in `removedColumns` (the user removed them in
//    that session). A tab that simply lacks a newer column can't erase it by omission.
//  - Min and Preferred may not exceed the effective Max (sent, else stored).
//  - The whole save is one transaction.
export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const { requirements, columns, removedColumns } = await req.json() as {
    requirements: unknown;
    columns: unknown;
    removedColumns?: unknown;
  };

  if (!Array.isArray(requirements) || !Array.isArray(columns)) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }
  const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  if (!columns.every(isStr)) {
    return NextResponse.json({ error: "columns must be a list of shift ids" }, { status: 400 });
  }
  if (removedColumns !== undefined && (!Array.isArray(removedColumns) || !removedColumns.every(isStr))) {
    return NextResponse.json({ error: "removedColumns must be a list of shift ids" }, { status: 400 });
  }
  const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  for (const r of requirements as ReqIn[]) {
    if (!r || typeof r !== "object") return NextResponse.json({ error: "Malformed requirement" }, { status: 400 });
    if (!isStr(r.shiftTypeId)) {
      // The pre-ID client sent { shiftCode, dayKey, ... }.
      if ("shiftCode" in r) return NextResponse.json(STALE_CLIENT, { status: 409 });
      return NextResponse.json({ error: "Each requirement needs a shiftTypeId" }, { status: 400 });
    }
    if (!isStr(r.dayKey)) return NextResponse.json({ error: "Each requirement needs a dayKey" }, { status: 400 });
    if (!isCount(r.minCount) || (r.preferredCount !== undefined && !isCount(r.preferredCount))) {
      return NextResponse.json({ error: "Counts must be whole numbers ≥ 0" }, { status: 400 });
    }
    if (r.maxCount !== undefined && r.maxCount !== null && !isCount(r.maxCount)) {
      return NextResponse.json({ error: "Max must be a whole number ≥ 0, or blank for no limit" }, { status: 400 });
    }
  }
  const reqs = requirements as Array<{ shiftTypeId: string; dayKey: string; minCount: number; preferredCount?: number; maxCount?: number | null }>;

  // Every reference must be a current shift ID — before anything is written.
  const shiftTypes = await prisma.shiftType.findMany({ select: { id: true, code: true } });
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  const currentCodes = new Set(shiftTypes.map((s) => s.code));
  const removedIn = (removedColumns ?? []) as string[];
  for (const ref of [...reqs.map((r) => r.shiftTypeId), ...(columns as string[]), ...removedIn]) {
    if (codeById.has(ref)) continue;
    if (currentCodes.has(ref)) return NextResponse.json(STALE_CLIENT, { status: 409 });
    return NextResponse.json({ error: `Unknown shift: ${ref}`, reason: "unknown-shift" }, { status: 400 });
  }
  const removed = removedIn.filter((id) => !reqs.some((r) => r.shiftTypeId === id));

  const stored = await prisma.staffingRequirement.findMany({ select: { shiftTypeId: true, dayKey: true, maxCount: true } });
  const storedMax = new Map(stored.map((r) => [`${r.shiftTypeId}:${r.dayKey}`, r.maxCount] as const));
  for (const r of reqs) {
    const max = r.maxCount !== undefined ? r.maxCount : (storedMax.get(`${r.shiftTypeId}:${r.dayKey}`) ?? null);
    if (max == null) continue;
    if (r.minCount > max || (r.preferredCount ?? 0) > max) {
      const code = codeById.get(r.shiftTypeId) ?? "?";
      return NextResponse.json(
        { error: `${code}: Min and Preferred can't be more than Max (${max})`, reason: "above-max", shiftTypeId: r.shiftTypeId, shiftCode: code, dayKey: r.dayKey },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    if (removed.length > 0) await tx.staffingRequirement.deleteMany({ where: { shiftTypeId: { in: removed } } });
    for (const r of reqs) {
      const max = r.maxCount !== undefined ? { maxCount: r.maxCount } : {};
      await tx.staffingRequirement.upsert({
        where: { shiftTypeId_dayKey: { shiftTypeId: r.shiftTypeId, dayKey: r.dayKey } },
        update: { minCount: r.minCount, preferredCount: r.preferredCount ?? 0, ...max },
        create: { shiftTypeId: r.shiftTypeId, dayKey: r.dayKey, minCount: r.minCount, preferredCount: r.preferredCount ?? 0, maxCount: r.maxCount ?? null },
      });
    }
  });

  const result = await prisma.staffingRequirement.findMany({
    orderBy: [{ shiftTypeId: "asc" }, { dayKey: "asc" }],
  });

  // The code is looked up live (never stored state): a renamed shift shows its new code.
  const rows = result.map((r) => ({
    id: r.id,
    shiftTypeId: r.shiftTypeId,
    shiftCode: codeById.get(r.shiftTypeId) ?? "?",
    dayKey: r.dayKey,
    minCount: r.minCount,
    preferredCount: r.preferredCount,
    maxCount: r.maxCount,
  }));
  rows.sort((a, b) => a.shiftCode.localeCompare(b.shiftCode) || a.dayKey.localeCompare(b.dayKey));
  return NextResponse.json(rows);
}
