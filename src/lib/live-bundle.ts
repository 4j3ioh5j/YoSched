// Guard at the Live input boundary (GET /api/auto-schedule/inputs → client engine).
//
// The grid's bundle and the server can be from different builds: a tab opened before a
// deploy runs the old engine against the new server, and after a rollback a tab on the
// NEW bundle fetches from the OLD server. The engine keys Staffing Rules by shiftTypeId;
// a bundle keyed only by shiftCode (pre-id-link server) would silently drop every
// minimum and cap, and Accept would persist the result (Codex #260). So the client checks
// the shape it depends on before solving and asks for a reload instead of guessing.

export const LIVE_BUNDLE_STALE_MESSAGE =
  "This page is out of date with the server — reload the page and try Live again.";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

/** null when the bundle is usable by THIS build's engine, else the message to show. */
export function liveBundleProblem(bundle: unknown): string | null {
  if (!isObj(bundle)) return LIVE_BUNDLE_STALE_MESSAGE;
  const reqs = bundle.staffingRequirements;
  if (!Array.isArray(reqs)) return LIVE_BUNDLE_STALE_MESSAGE;
  for (const r of reqs) {
    if (!isObj(r) || typeof r.shiftTypeId !== "string" || typeof r.dayKey !== "string") {
      return LIVE_BUNDLE_STALE_MESSAGE;
    }
  }
  if (!Array.isArray(bundle.shiftTypes) || !Array.isArray(bundle.existingAssignments)) {
    return LIVE_BUNDLE_STALE_MESSAGE;
  }
  return null;
}
