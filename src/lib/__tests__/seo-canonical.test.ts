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

// Item 4 of handoff #509: the origin is reachable both through the apex proxy and directly
// at its tunnel alias. Only the apex copy may be indexed.
describe("noindex on non-apex hostnames", () => {
  async function noindexRule() {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.headers.some((h) => h.key === "X-Robots-Tag"));
    if (!rule) throw new Error("no X-Robots-Tag rule found in next.config headers()");
    return rule;
  }

  it("emits noindex, nofollow", async () => {
    const rule = await noindexRule();
    expect(rule.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  });

  it("keys off x-forwarded-host, not Host", async () => {
    const rule = await noindexRule();
    // Host is rewritten by the tunnel and cannot be set by the Pages Function, so it is
    // identical for a proxied request and a direct alias hit. Keying off it would noindex
    // the apex. X-Forwarded-Host is the only header that distinguishes them.
    expect(rule.missing).toEqual([
      { type: "header", key: "x-forwarded-host", value: expect.any(String) },
    ]);
  });

  it("applies to every path", async () => {
    const rule = await noindexRule();
    expect(rule.source).toBe("/:path*");
  });

  // Next wraps `missing[].value` in an anchored ^...$ regex. The rule fires when the
  // header is absent OR does not match — so this pattern decides who stays indexable.
  it("matches the apex exactly and nothing else", async () => {
    const rule = await noindexRule();
    const pattern = new RegExp(`^${rule.missing![0].value}$`);

    // The one host that must NOT get noindex.
    expect(pattern.test("yologiq.com")).toBe(true);

    // The duplicate we are suppressing.
    expect(pattern.test("app-yosched.yologiq.com")).toBe(false);
    // Regression: an unescaped "." would make this a wildcard and let look-alikes through.
    expect(pattern.test("yologiqXcom")).toBe(false);
    expect(pattern.test("yologiq.com.evil.example")).toBe(false);
    expect(pattern.test("notyologiq.com")).toBe(false);
    expect(pattern.test("")).toBe(false);
  });
});
