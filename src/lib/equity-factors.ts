// Equity factors are linked to the shift's id (equity_factors.shiftTypeId); the shift CODE
// the fairness math keys on is derived here, at read time, from the shift_types rows loaded
// in the same request — so a rename can never leave a factor pointing at a dead code.
// Pure (no DB/React): used by the server loaders, the API route and the Settings section.

import type { EquityFactor } from "@/lib/fairness";
import { STALE_CLIENT } from "@/lib/stale-client";

export type EquityFactorRow = {
  factorType: string;
  shiftTypeId: string | null;
  weight: number;
  enabled: boolean;
};

/** DB rows → in-memory factors with the shift's CURRENT code (null for built-ins or an unknown id). */
export function deriveEquityFactorCodes<R extends EquityFactorRow>(
  rows: readonly R[],
  shiftTypes: readonly { id: string; code: string }[],
): (R & { shiftCode: string | null })[] {
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  return rows.map((r) => ({
    ...r,
    shiftCode: r.factorType === "shift" && r.shiftTypeId ? (codeById.get(r.shiftTypeId) ?? null) : null,
  }));
}

export type EquityFactorIn = { factorType: string; shiftTypeId: string | null; weight: number; enabled: boolean };

/** Where the Settings section saves. The pre-slice server has no such route (404), so a
 *  save from a new tab against a rolled-back server fails closed. */
export const EQUITY_FACTORS_SAVE_URL = "/api/settings/equity-factors/by-shift-id";

/** The save payload: ids only. The shift code is display state (from the shared shift list)
 *  and must never travel in a write — a server could resolve a renamed-and-reused code to
 *  the wrong shift. */
export function buildEquityFactorsSave(
  factors: readonly { factorType: string; shiftTypeId: string | null; weight: number; enabled: boolean }[],
): { factors: (EquityFactorIn & { sortOrder: number })[] } {
  return {
    factors: factors.map((f, i) => ({
      factorType: f.factorType,
      shiftTypeId: f.factorType === "shift" ? f.shiftTypeId : null,
      weight: f.weight,
      enabled: f.enabled,
      sortOrder: i,
    })),
  };
}

/** The message for a failed save. 404/405 = the server has no such route (it predates this
 *  slice) → reload; otherwise the server's own `error` text when it sent one. */
export function equitySaveErrorMessage(status: number, bodyText: string): string {
  if (status === 404 || status === 405) return STALE_CLIENT.error;
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown };
    if (parsed && typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    // not JSON — fall through to the raw text
  }
  return bodyText || `Save failed (${status})`;
}

export type { EquityFactor };
