import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { deriveEquityFactorCodes } from "@/lib/equity-factors";
import { STALE_CLIENT } from "@/lib/stale-client";

// Equity factors, linked to the shift's ID. The list IS the setting: the body replaces all
// rows. Every shift reference must be a current shift id and the body must carry no shift
// code at all — this path exists so that a save from a new tab can never be interpreted by
// a server that still resolves codes (a pre-slice server has no such route and answers 404).
type FactorIn = { factorType?: unknown; shiftTypeId?: unknown; shiftCode?: unknown; weight?: unknown; enabled?: unknown; sortOrder?: unknown };

const BUILTIN = new Set(["desirability", "holiday"]);

function bad(error: string, reason: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, reason, ...extra }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;

  const body = (await req.json()) as { factors?: unknown };
  if (!Array.isArray(body?.factors)) return bad("factors must be an array", "bad-request");
  const factors = body.factors as FactorIn[];

  const shiftTypes = await prisma.shiftType.findMany({ select: { id: true, code: true } });
  const currentIds = new Set(shiftTypes.map((s) => s.id));
  const currentCodes = new Set(shiftTypes.map((s) => s.code));

  // Validate everything before any write.
  const seen = new Set<string>();
  const rows: { factorType: string; shiftTypeId: string | null; weight: number; enabled: boolean; sortOrder: number }[] = [];
  for (const [i, f] of factors.entries()) {
    if (!f || typeof f !== "object") return bad(`factor ${i}: not an object`, "bad-request");
    if ("shiftCode" in f) return bad(`factor ${i}: shiftCode is not accepted here; send shiftTypeId`, "bad-request");
    if (typeof f.factorType !== "string" || !f.factorType) return bad(`factor ${i}: factorType required`, "bad-request");
    const weight = typeof f.weight === "number" && Number.isFinite(f.weight) ? f.weight : NaN;
    if (!(weight > 0)) return bad(`factor ${i}: weight must be a positive number`, "bad-request");
    const enabled = typeof f.enabled === "boolean" ? f.enabled : true;
    const sortOrder = typeof f.sortOrder === "number" && Number.isInteger(f.sortOrder) ? f.sortOrder : i;

    let shiftTypeId: string | null = null;
    if (f.factorType === "shift") {
      if (typeof f.shiftTypeId !== "string" || !f.shiftTypeId) return bad(`factor ${i}: shift factor needs shiftTypeId`, "bad-request");
      if (!currentIds.has(f.shiftTypeId)) {
        // A current CODE where an id belongs is a tab from before the id link.
        if (currentCodes.has(f.shiftTypeId)) return NextResponse.json(STALE_CLIENT, { status: 409 });
        return bad(`Unknown shift ${f.shiftTypeId}`, "unknown-shift", { shiftTypeId: f.shiftTypeId });
      }
      shiftTypeId = f.shiftTypeId;
    } else {
      if (!BUILTIN.has(f.factorType)) return bad(`factor ${i}: unknown factorType ${f.factorType}`, "bad-request");
      if (f.shiftTypeId != null) return bad(`factor ${i}: ${f.factorType} takes no shiftTypeId`, "bad-request");
    }
    const key = `${f.factorType}:${shiftTypeId ?? ""}`;
    if (seen.has(key)) return bad(`factor ${i}: duplicate ${f.factorType} factor`, "duplicate", { factorType: f.factorType, shiftTypeId });
    seen.add(key);
    rows.push({ factorType: f.factorType, shiftTypeId, weight, enabled, sortOrder });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.equityFactor.deleteMany({});
    if (rows.length > 0) await tx.equityFactor.createMany({ data: rows });
    return tx.equityFactor.findMany({ orderBy: { sortOrder: "asc" } });
  });

  return NextResponse.json(deriveEquityFactorCodes(result, shiftTypes));
}
