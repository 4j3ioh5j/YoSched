// The URL sub-path the whole app is served under. YoSched lives at
// `https://yologiq.com/yosched` (an apex path, proxied to this origin), so Next.js
// runs with `basePath: BASE_PATH` — every route, asset, link, API path, cookie and
// auth endpoint lives beneath it. Keep this in sync with `basePath` in next.config.ts
// (that file can't import app modules, so the literal is duplicated there with a note).
export const BASE_PATH = "/yosched";

// Auth.js's own route base (the `[...nextauth]` handler + client), under BASE_PATH.
export const AUTH_BASE_PATH = `${BASE_PATH}/api/auth`;

// The one hostname the app is meant to be indexed under. The origin is also reachable
// at its tunnel alias (app-yosched.yologiq.com), which serves byte-identical pages —
// so every indexable URL we emit has to name the apex explicitly.
export const CANONICAL_ORIGIN = "https://yologiq.com";

// The public root of the app: apex + basePath, no trailing slash.
export const SITE_URL = `${CANONICAL_ORIGIN}${BASE_PATH}`;

// Absolute canonical URL for a basePath-relative route ("/" -> the app root).
// Canonical tags, og:url and sitemap entries all go through here so they can never
// disagree about the trailing slash — `/yosched` and `/yosched/` are distinct URLs to
// a crawler, and emitting both is exactly the duplicate we're trying to avoid.
export function canonicalUrl(routePath: string = "/"): string {
  if (!routePath.startsWith("/")) {
    throw new Error(`canonicalUrl: route must start with "/" (got ${JSON.stringify(routePath)})`);
  }
  const trimmed = routePath.replace(/\/+$/, "");
  return trimmed === "" ? SITE_URL : `${SITE_URL}${trimmed}`;
}
