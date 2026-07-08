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
