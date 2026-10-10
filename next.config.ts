import type { NextConfig } from "next";

const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Course thumbnails uploaded through the teacher dashboard.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: cloudName ? `/${cloudName}/image/upload/**` : "/**",
      },
    ],
  },
  async redirects() {
    // The teacher area used to live at /admin.
    return [
      { source: "/admin", destination: "/teacher", permanent: false },
      { source: "/admin/:path*", destination: "/teacher", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
