import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@poketrack/db", "@poketrack/jobs", "@poketrack/scan"],
  serverExternalPackages: ["pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
