import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

const MAX_LEVELS = 4

function loadDotEnv(startDir: string = process.cwd()): string | null {
  let dir = startDir
  for (let level = 0; level < MAX_LEVELS; level++) {
    const file = join(dir, ".env")
    if (existsSync(file)) {
      process.loadEnvFile(file)
      return file
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export { loadDotEnv }
