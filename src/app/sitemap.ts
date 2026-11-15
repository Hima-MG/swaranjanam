import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";
import { getPublishedCourses } from "@/lib/catalog/server";

/**
 * Public pages plus every publicly listed course. Course URLs come from the
 * same cached catalogue as the homepage, so publishing, unpublishing or
 * deleting a course updates the sitemap too (CATALOG_TAG).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url;
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/contact`, changeFrequency: "monthly", priority: 0.7 },
  ];
  const catalog = await getPublishedCourses();
  const courses: MetadataRoute.Sitemap = catalog.ok
    ? catalog.data.map((course) => ({ url: `${base}/courses/${course.slug}`, changeFrequency: "weekly", priority: 0.8 }))
    : [];
  return [...pages, ...courses];
}
