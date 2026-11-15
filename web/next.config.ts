import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The assistant API route reads the published JSON contract from disk.
  outputFileTracingIncludes: {
    "/api/assistant": ["./public/data/**/*"],
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
