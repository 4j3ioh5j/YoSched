import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/base-path";

// Serves /yosched/sitemap.xml — the list of public URLs we want crawlers to know about.
// Only the unauthenticated pages belong here; the app itself is behind login.
//
// Every URL goes through canonicalUrl() so a sitemap entry can never disagree with the
// page's own <link rel="canonical">. (It used to list the root as ".../yosched/", with a
// trailing slash the canonical does not have — two URLs for one page.)
//
// /login is deliberately absent: it is noindex, and listing a noindex URL in a sitemap is
// a contradictory signal.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: canonicalUrl("/"), changeFrequency: "monthly", priority: 1 },
    { url: canonicalUrl("/privacy"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
