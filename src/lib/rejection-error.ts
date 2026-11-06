/**
 * A failed assignment write, tagged so the grid can tell a per-day-cap rejection
 * (HTTP 409, body.reason "day-full", from src/lib/day-cap-db.ts) from any other
 * failure and react accordingly.
 *
 * `serverText` is the server's own cap sentence ("Only 0 ORC allowed on Mondays").
 * The grid shows THAT, not a sentence rebuilt from the Staffing Rules the page loaded:
 * the whole point of a server 409 is that the server's rules or grid differ from the
 * browser's copy, so the browser's copy is the one thing the message must not use.
 */
export type RejectionError = Error & { dayFull?: boolean; busy?: boolean; serverText?: string };

/**
 * `busy` (HTTP 409, body.reason "busy"): the server gave up waiting for another save
 * on the same day (src/lib/day-cap-db.ts busyResponse). Nothing was written; the grid
 * reverts the cell and shows the server's retry sentence — it is not a rule violation
 * and must never reload the page or cancel a Live sandbox.
 */
export async function rejectionError(res: Response): Promise<RejectionError> {
  const body = await res.json().catch(() => null);
  const dayFull = body?.reason === "day-full";
  const busy = body?.reason === "busy";
  const serverText = dayFull && typeof body?.error === "string" && body.error.length > 0 ? body.error : undefined;
  return Object.assign(new Error(body?.error ?? `request failed: ${res.status}`), { dayFull, busy, serverText });
}

/**
 * The red-border popover text for a day-full rejection. `serverText` (when the refusal
 * came from the server) replaces the limit clause wholesale; the client-built clause is
 * only for the browser's own pre-check, where no server has spoken yet.
 */
export function dayFullPopoverText(opts: {
  serverText?: string;
  code: string;
  cap: number;
  dayLabel: string; // "on Mondays" / "on holidays" (dayKeyLabel)
  day: string; // the formatted date, e.g. "11/2"
  more: string; // "" or " (+N more)"
}): string {
  const { serverText, code, cap, dayLabel, day, more } = opts;
  const limit = serverText
    ?? `${cap === 0 ? `No ${code}` : cap === 1 ? `Only one ${code}` : `Only ${cap} ${code}`} allowed ${dayLabel}`;
  return `${limit} — ${day} is already full${more}`;
}
