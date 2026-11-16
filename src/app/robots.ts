import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";

/** Public pages are crawlable; signed-in areas, enrolment steps and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/teacher", "/dashboard", "/receipts", "/admin", "/enrol", "/api/"],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
