import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config";
import { SITE_URL, canonicalUrl } from "../base-path";
import sitemap from "../../app/sitemap";
import robots from "../../app/robots";

describe("canonicalUrl", () => {
  it("maps the app root to the apex path with no trailing slash", () => {
    expect(canonicalUrl("/")).toBe("https://yologiq.com/yosched");
    expect(SITE_URL).toBe("https://yologiq.com/yosched");
  });

  it("appends sub-paths", () => {
    expect(canonicalUrl("/privacy")).toBe("https://yologiq.com/yosched/privacy");
  });

  it("never emits a trailing slash, however the caller writes the route", () => {
    expect(canonicalUrl("/privacy/")).toBe(canonicalUrl("/privacy"));
    expect(canonicalUrl("//")).toBe(canonicalUrl("/"));
  });

  it("rejects a route that isn't basePath-relative", () => {
    expect(() => canonicalUrl("privacy")).toThrow();
    // An absolute URL would silently produce "https://yologiq.com/yoschedhttps://..."
    expect(() => canonicalUrl("https://evil.example/")).toThrow();
  });
});

describe("sitemap", () => {
  it("lists only canonical URLs (so it can never disagree with rel=canonical)", () => {
    for (const entry of sitemap()) {
      expect(entry.url).toBe(canonicalUrl(entry.url.slice(SITE_URL.length) || "/"));
      expect(entry.url.endsWith("/")).toBe(false);
    }
  });

  it("does not advertise the noindex login page", () => {
    expect(sitemap().map((e) => e.url)).not.toContain(canonicalUrl("/login"));
  });
});

describe("robots.txt sitemap pointer", () => {
  it("points at the apex-hosted sitemap", () => {
    expect(robots().sitemap).toBe("https://yologiq.com/yosched/sitemap.xml");
  });
});

// Regression guard for b3456e0, reverted in the same session.
//
// A hostname-keyed `X-Robots-Tag: noindex` rule was added here to stop the tunnel alias
// (app-yosched.yologiq.com) being indexed alongside the apex. It noindexed the APEX in
// production: this origin sees an identical `Host` (rewritten by the tunnel) and never
// receives `X-Forwarded-Host: yologiq.com` (Cloudflare rewrites X-Forwarded-* inbound),
// so "is this the apex?" is simply not answerable here.
//
// Until the alias is suppressed upstream (handoff #510), this app must never emit
// X-Robots-Tag at all — emitting it unconditionally deindexes the real page.
describe("next.config headers", () => {
  it("never emits X-Robots-Tag — the origin cannot identify the apex, see comment", async () => {
    const rules = await nextConfig.headers!();
    const robotsHeaders = rules.flatMap((r) => r.headers.filter((h) => /^x-robots-tag$/i.test(h.key)));
    expect(robotsHeaders).toEqual([]);
  });

  it("still ships the baseline security headers on every path", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/:path*");
    expect(rule?.headers.map((h) => h.key)).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ]),
    );
  });
});
