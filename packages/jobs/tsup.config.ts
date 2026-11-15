import { defineConfig } from "tsup"

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: "cjs",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  noExternal: [/.*/],
  external: ["pg-native"],
})
