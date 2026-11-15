import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"
import { loadDotEnv } from "./env"

afterEach(() => {
  delete process.env.POKETRACK_ENV_TEST
  delete process.env.POKETRACK_ENV_KEEP
})

test("loads the nearest .env from a parent directory", () => {
  const root = mkdtempSync(join(tmpdir(), "poketrack-env-"))
  const nested = join(root, "packages", "jobs")
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(root, ".env"), "POKETRACK_ENV_TEST=from-file\n")
  expect(loadDotEnv(nested)).toBe(join(root, ".env"))
  expect(process.env.POKETRACK_ENV_TEST).toBe("from-file")
})

test("a variable already set in the environment wins over the file", () => {
  const root = mkdtempSync(join(tmpdir(), "poketrack-env-"))
  writeFileSync(join(root, ".env"), "POKETRACK_ENV_KEEP=from-file\n")
  process.env.POKETRACK_ENV_KEEP = "from-shell"
  loadDotEnv(root)
  expect(process.env.POKETRACK_ENV_KEEP).toBe("from-shell")
})

test("no .env anywhere nearby is fine", () => {
  const root = mkdtempSync(join(tmpdir(), "poketrack-env-"))
  expect(loadDotEnv(root)).toBeNull()
})
