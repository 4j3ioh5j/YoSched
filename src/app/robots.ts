import type { MetadataRoute } from "next";

// Serves /robots.txt. Web-filter categorization crawlers and search engines
// fetch this first; a real robots.txt (instead of the old redirect-to-login) is
// part of looking like a legitimate site. We invite crawling of the public
// pages and keep the authenticated app out of any index.
const BASE_URL = "https://yosched.yologiq.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/privacy"],
      disallow: ["/api/", "/settings", "/staff", "/users", "/equity", "/requests", "/my-requests", "/account"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
