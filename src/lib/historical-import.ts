/**
 * Pure helpers for the historical schedule import (prisma/seed-historical-import.ts).
 * Kept DB-free so the resolvability check is unit-testable and can run as a
 * pre-flight BEFORE the seed writes anything (avoids leaving partial setup rows
 * when a remap target — e.g. PRE — is missing from the target database).
 */
export type ImportRow = { date: string; initials: string; code: string };

/**
 * Given the import rows and the codes / provider-initials that will exist after
 * the seed ensures `extraCodes` / `extraInitials`, return everything referenced
 * by the data that still would NOT resolve. An empty result means the import can
 * proceed without leaving orphan setup rows.
 */
export function findUnmappedTargets(
  data: ImportRow[],
  existingCodes: Iterable<string>,
  existingInitials: Iterable<string>,
  extraCodes: Iterable<string> = [],
  extraInitials: Iterable<string> = [],
): { codes: string[]; initials: string[] } {
  const codes = new Set<string>([...existingCodes, ...extraCodes]);
  const initials = new Set<string>([...existingInitials, ...extraInitials]);
  const missingCodes = new Set<string>();
  const missingInitials = new Set<string>();
  for (const r of data) {
    if (!codes.has(r.code)) missingCodes.add(r.code);
    if (!initials.has(r.initials)) missingInitials.add(r.initials);
  }
  return { codes: [...missingCodes].sort(), initials: [...missingInitials].sort() };
}
