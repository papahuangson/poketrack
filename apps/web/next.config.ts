import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@poketrack/db", "@poketrack/jobs"],
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
