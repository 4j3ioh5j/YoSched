import type { MetadataRoute } from "next";

// Serves /sitemap.xml — the list of public URLs we want crawlers to know about.
// Only the unauthenticated pages belong here; the app itself is behind login.
const BASE_URL = "https://yologiq.com/yosched";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/login`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
