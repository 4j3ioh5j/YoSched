// Card #482: a Settings save counts only when the server's answer kept the fields that matter.
// An older server (a rollback) ignores a field it does not know and still answers 200.

/** The keys in `keys` whose value the server's answer does not hold as sent. */
export function unsavedKeys(body: Record<string, unknown>, returned: unknown, keys: readonly string[]): string[] {
  if (!returned || typeof returned !== "object" || Array.isArray(returned)) return [...keys];
  const r = returned as Record<string, unknown>;
  return keys.filter((k) => !Object.prototype.hasOwnProperty.call(r, k) || r[k] !== body[k]);
}
