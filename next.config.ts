import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  images: {
    // uploaded room photos on Vercel Blob (src/server/storage.ts); nothing else remote is optimized
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com", port: "", pathname: "/rooms/**", search: "" }],
  },
  partialPrefetching: true,
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
