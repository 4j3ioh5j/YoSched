"use client";

import { BASE_PATH } from "@/lib/base-path";

// The app is served under BASE_PATH (Next.js `basePath`). Next automatically
// prefixes <Link>, router navigations, static assets and next/image with it — but a
// raw `fetch("/api/…")` is NOT rewritten, so every same-origin absolute request the
// client makes would otherwise miss the prefix and 404 at the apex proxy (which only
// forwards /yosched/*). Rather than prefix ~100 call sites by hand (and risk missing
// one), we patch fetch once, on the client only, to add BASE_PATH to app-absolute
// paths. Left untouched: external URLs, protocol-relative URLs (`//host`), and paths
// already under BASE_PATH (e.g. Auth.js client calls, which carry the prefix because
// SessionProvider is configured with it). Idempotent across HMR / remounts.

const FLAG = "__yoschedBasePathFetchPatched";

function prefixPath(path: string): string {
  if (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    path !== BASE_PATH &&
    !path.startsWith(BASE_PATH + "/")
  ) {
    return BASE_PATH + path;
  }
  return path;
}

if (typeof window !== "undefined") {
  const w = window as unknown as { [FLAG]?: boolean };
  if (!w[FLAG]) {
    w[FLAG] = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      // Plain string URL — the common case (fetch("/api/…")).
      if (typeof input === "string") {
        return originalFetch(prefixPath(input), init);
      }
      // URL object.
      if (input instanceof URL) {
        if (input.origin === window.location.origin) {
          const rewritten = new URL(input.toString());
          rewritten.pathname = prefixPath(rewritten.pathname);
          return originalFetch(rewritten, init);
        }
        return originalFetch(input, init);
      }
      // Request object.
      if (input instanceof Request) {
        try {
          const u = new URL(input.url, window.location.origin);
          if (u.origin === window.location.origin) {
            const newPath = prefixPath(u.pathname);
            if (newPath !== u.pathname) {
              u.pathname = newPath;
              return originalFetch(new Request(u.toString(), input), init);
            }
          }
        } catch {
          // Fall through to the unmodified request on any URL parse failure.
        }
        return originalFetch(input, init);
      }
      return originalFetch(input as RequestInfo, init);
    };
  }
}
