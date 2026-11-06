/**
 * How the grid reads a refused request-status PATCH (/api/requests/[id]).
 *
 * Two 409s exist: the approval could not be honoured because a covered day is
 * locked-and-unsatisfied (body has `blockedDates`, no `reason`), and — since card #65 —
 * the placement waited too long on another save for one of those days (body.reason
 * "busy", nothing placed; a retry, not a rule). The grid used to label every 409
 * "locked", which hid the retry sentence (Codex #315).
 */
export type RequestRefusal = "locked" | "busy" | "other";

export function classifyRequestRefusal(httpStatus: number, body: unknown): RequestRefusal {
  if (httpStatus !== 409) return "other";
  return (body as { reason?: unknown } | null)?.reason === "busy" ? "busy" : "locked";
}

/** The one-line error under the grid after a batch of approvals/denials/resets. */
export function requestFailureText(opts: { failed: number; locked: number; busy: number; busyText?: string; verb: string }): string {
  const { failed, locked, busy, busyText, verb } = opts;
  const parts: string[] = [];
  if (locked > 0) parts.push(`${locked} locked`);
  if (busy > 0) parts.push(`${busy} waiting on another save — ${busyText?.trim() || "try again"}`);
  return `${failed} request(s) couldn't be ${verb}${parts.length ? ` (${parts.join("; ")})` : ""}.`;
}
