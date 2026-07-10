import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/base-path";

// Serves /yosched/robots.txt.
//
// IMPORTANT: crawlers only honour robots.txt at the ROOT of a host — for the apex that is
// https://yologiq.com/robots.txt, which is YoLogiq's static file, not this one. Because the
// app runs under `basePath: /yosched`, this route is emitted at /yosched/robots.txt, where
// Google will never look for directives. So the rules below are DOCUMENTATION of intent,
// not an enforced policy: the real allow/disallow list for these paths has to live in the
// apex robots.txt (see handoff #510 to YoLogiq).
//
// What actually keeps the authenticated app out of the index is `src/middleware.ts`, which
// bounces every non-public path to /login before a crawler ever sees content, plus the
// per-route `robots: { index: false }` metadata on /login itself.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/privacy"],
      disallow: ["/api/", "/settings", "/staff", "/users", "/equity", "/requests", "/my-requests", "/account"],
    },
    sitemap: canonicalUrl("/sitemap.xml"),
  };
}
