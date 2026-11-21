import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// One shared .env at the repo root; never overrides vars already set (e.g. on Render).
if (existsSync("../.env")) process.loadEnvFile("../.env");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
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
