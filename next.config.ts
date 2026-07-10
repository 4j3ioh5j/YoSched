import type { NextConfig } from "next";

// Security headers applied to every response. These are a modest reputation
// signal for scanners/filters and good practice generally. We deliberately do
// NOT set a strict Content-Security-Policy here — Next.js relies on inline
// bootstrap scripts, so a wrong CSP would break the app; that's a separate,
// carefully-tested follow-up.
const securityHeaders = [
  // Force HTTPS for a year, including subdomains. (No "preload" — that requires
  // the apex to be set up and submitted first.)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Don't let browsers MIME-sniff responses into a different content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disallow the app being framed by other origins (clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Send only the origin (not the full path) on cross-origin navigations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We don't use these powerful features — deny them by default.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// DO NOT add an `X-Robots-Tag: noindex` rule keyed on the request's hostname here.
// It was tried (b3456e0) and reverted the same day, because this origin CANNOT tell an
// apex-proxied request apart from a direct hit on its tunnel alias:
//
//   * `Host` is rewritten to yologiq.com by the tunnel (httpHostHeader) for BOTH, and a
//     Cloudflare Pages Function is forbidden from setting Host on its outbound fetch.
//   * `X-Forwarded-Host` never arrives as "yologiq.com" either. The Pages Function does
//     set it, but Cloudflare strips/rewrites the X-Forwarded-* family inbound. Verified
//     against production: even `curl -H 'X-Forwarded-Host: yologiq.com'` sent straight at
//     app-yosched.yologiq.com still matched the "not the apex" rule.
//
// Net effect of that rule was `noindex` on the real apex page — the exact opposite of the
// intent. Both requests look identical here, so the alias has to be suppressed upstream:
// either the Pages Function sets a custom (non X-Forwarded-*) marker header this app can
// require, or Admin makes the tunnel alias non-public. See handoff #510.
//
// The canonical tags (src/app/page.tsx, src/app/privacy/page.tsx) already point both copies
// at the apex, which is what actually defuses the duplicate.

const nextConfig: NextConfig = {
  output: "standalone",
  // The app is served under the `/yosched` sub-path of the apex domain
  // (yologiq.com/yosched, reverse-proxied to this origin with the prefix kept).
  // basePath makes Next emit every route, asset and next/image URL under it.
  // NOTE: keep in sync with BASE_PATH in src/lib/base-path.ts — this config file
  // can't import app modules, so the literal is duplicated here deliberately.
  basePath: "/yosched",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
