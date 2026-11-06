/**
 * How the grid reads the outcome of a request-status PATCH (/api/requests/[id]).
 *
 * Since card #67 an approval that cannot be honoured without breaking a hard rule is
 * not a refusal: it answers 200 with `flagged: true` and the request stays pending,
 * marked "needs resolving" with a plain reason. The only 409 left is the busy retry
 * (card #65): the placement waited too long on another save for one of those days
 * (body.reason "busy", nothing placed; a retry, not a rule). The old locked-day 409
 * (`blockedDates`) is retired — a locked, unsatisfied day now flags the request too.
 */
export type RequestRefusal = "busy" | "other";

export function classifyRequestRefusal(httpStatus: number, body: unknown): RequestRefusal {
  if (httpStatus !== 409) return "other";
  return (body as { reason?: unknown } | null)?.reason === "busy" ? "busy" : "other";
}

/** The one-line error under the grid after a batch of approvals/denials/resets. */
export function requestFailureText(opts: { failed: number; busy: number; busyText?: string; verb: string }): string {
  const { failed, busy, busyText, verb } = opts;
  const parts: string[] = [];
  if (busy > 0) parts.push(`${busy} waiting on another save — ${busyText?.trim() || "try again"}`);
  return `${failed} request(s) couldn't be ${verb}${parts.length ? ` (${parts.join("; ")})` : ""}.`;
}

/** The one-line notice under the grid when approvals were flagged instead of placed.
 *  `reason` is the server's sentence for the first flagged request. */
export function requestFlaggedText(count: number, reason: string | undefined): string {
  const why = reason?.trim();
  return `${count} request(s) were flagged instead of approved${why ? `: ${why}` : ""}.`;
}
