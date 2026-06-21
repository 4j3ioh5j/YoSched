import { prisma } from "@/lib/prisma";

/**
 * Resolve assignment `updatedBy` user ids to display NAMES for conflict payloads.
 *
 * Privacy: returns the name only — never the email or the raw user id. Callers are
 * all schedule:edit routes, so the viewer is authorized to see who edited a cell.
 * Batched: one query per response regardless of how many cells conflicted (CR #676).
 */
export async function resolveUpdaterNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name ?? "Unknown"]));
}

/** The display name for a row's updater, or null when unknown/unattributed. */
export function updaterName(updatedBy: string | null | undefined, names: Map<string, string>): string | null {
  return updatedBy ? names.get(updatedBy) ?? null : null;
}

/**
 * The `autoShiftTypeId` column value for a cell after a manual write places
 * `newShiftTypeId` over the `existing` row — this is what lets the cell tooltip
 * show "Auto → Manual (was X)".
 *
 * A cell's "auto baseline" is what the Auto-schedule run originally placed
 * there: the row's own shiftTypeId while it is still source="auto", or a
 * previously-captured autoShiftTypeId once a manual edit has already overridden
 * it. We record that baseline whenever the new manual value differs from it,
 * and null otherwise (cell was never auto, or it was edited back to the auto
 * value).
 *
 * Always returns an explicit string|null (never undefined), so it is correct
 * both for an `upsert.update` (row persists) AND for a delete-then-create
 * (the drag/swap path) — where "leave unchanged" would silently drop the
 * baseline. Carrying the baseline forward also preserves the original auto
 * value across repeated edits and across a swap onto an already-overridden cell.
 */
export function resolveAutoOverride(
  existing: { source: string; shiftTypeId: string; autoShiftTypeId: string | null } | null,
  newShiftTypeId: string,
): string | null {
  if (!existing) return null;
  const autoBaseline = existing.source === "auto" ? existing.shiftTypeId : existing.autoShiftTypeId;
  return autoBaseline && autoBaseline !== newShiftTypeId ? autoBaseline : null;
}
