// The one answer for a Settings tab whose bundle predates a re-keyed setting: never
// guess what it meant (a renamed-and-reused shift code can name the wrong shift), tell
// it to reload. Shared by every write route that refuses old-shape bodies.
export const STALE_CLIENT = {
  error: "Settings have changed since this page was loaded — reload the page and try again.",
  reason: "stale-client",
} as const;
