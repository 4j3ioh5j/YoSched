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
