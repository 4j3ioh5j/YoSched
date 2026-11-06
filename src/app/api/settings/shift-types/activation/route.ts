// Card #75: the "turn a shift's Auto-schedule on" panel.
//   GET  ?id=<shiftTypeId> → who is active, who has worked the shift, current eligibility and
//        new-hire defaults, the department defaults, and a version for compare-and-set.
//   POST {id, version, autoSchedulable, eligibleStaffIds, defaultEmploymentTypeIds, shift?}
//        → applies it atomically (see src/lib/shift-activation.ts); returns the inverse for Undo.
import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  readActivationState, applyActivation, ActivationStale,
  parseActivationWorked, parseActivationNever, parseActivationNewHire,
} from "@/lib/shift-activation";
import { SHIFT_TYPE_EDITABLE_FIELDS, sanitizePrintBg } from "@/lib/shift-type-fields";

export async function GET(req: NextRequest) {
  const { error } = await getSession("settings:view");
  if (error) return error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const [state, prefs] = await Promise.all([
    readActivationState(prisma, id),
    prisma.schedulingPreferences.findFirst(),
  ]);
  if (!state) return NextResponse.json({ error: "Shift type not found" }, { status: 404 });
  return NextResponse.json({
    ...state,
    defaults: {
      worked: parseActivationWorked(prefs?.activationWorkedDefault),
      never: parseActivationNever(prefs?.activationNeverDefault),
      newHire: parseActivationNewHire(prefs?.activationNewHireDefault),
    },
  });
}

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export async function POST(req: NextRequest) {
  const { error } = await getSession("settings:edit");
  if (error) return error;
  const body = await req.json();
  const { id, version, autoSchedulable, eligibleStaffIds, defaultEmploymentTypeIds, shift } = body ?? {};
  if (typeof id !== "string" || typeof version !== "string" || typeof autoSchedulable !== "boolean" || !isIdList(eligibleStaffIds) || !isIdList(defaultEmploymentTypeIds)) {
    return NextResponse.json({ error: "Expected {id, version, autoSchedulable, eligibleStaffIds[], defaultEmploymentTypeIds[]}" }, { status: 400 });
  }
  // Other edits to the shift saved in the same write (the Settings editor's unsaved fields).
  const shiftData: Prisma.ShiftTypeUpdateInput = {};
  if (shift && typeof shift === "object") {
    for (const key of SHIFT_TYPE_EDITABLE_FIELDS) {
      if (key === "autoSchedulable") continue;
      if (key in shift) (shiftData as Record<string, unknown>)[key] = (shift as Record<string, unknown>)[key];
    }
    if ("printBackgroundColor" in shiftData) (shiftData as Record<string, unknown>).printBackgroundColor = sanitizePrintBg((shift as Record<string, unknown>).printBackgroundColor);
  }
  try {
    const result = await prisma.$transaction(
      (tx) => applyActivation(tx, { shiftTypeId: id, version, autoSchedulable, eligibleStaffIds, defaultEmploymentTypeIds, shiftData }),
      { timeout: 15_000, maxWait: 10_000 },
    );
    if (!result) return NextResponse.json({ error: "Shift type not found" }, { status: 404 });
    const updated = await prisma.shiftType.findUnique({ where: { id } });
    return NextResponse.json({ shift: updated, inverse: result.inverse, state: result.state });
  } catch (e) {
    if (e instanceof ActivationStale) return NextResponse.json({ error: e.message, reason: "stale" }, { status: 409 });
    throw e;
  }
}
