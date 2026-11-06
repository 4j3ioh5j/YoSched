// The one answer for a Settings tab whose bundle predates a re-keyed setting: never
// guess what it meant (a renamed-and-reused shift code can name the wrong shift), tell
// it to reload. Shared by every write route that refuses old-shape bodies.
export const STALE_CLIENT = {
  error: "Settings have changed since this page was loaded — reload the page and try again.",
  reason: "stale-client",
} as const;

/** The message for a failed save of a re-keyed setting. 404/405 = the server has no such
 *  route (it predates the slice that moved the write) → reload; otherwise the server's own
 *  `error` text when it sent one, else the raw body. */
export function saveErrorMessage(status: number, bodyText: string): string {
  if (status === 404 || status === 405) return STALE_CLIENT.error;
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown };
    if (parsed && typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch {
    // not JSON — fall through to the raw text
  }
  return bodyText || `Save failed (${status})`;
}
