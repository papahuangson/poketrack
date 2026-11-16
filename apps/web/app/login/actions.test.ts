import { afterEach, beforeEach, expect, test, vi } from "vitest"

const set = vi.fn()
const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { to })
})
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }))

let db: import("@poketrack/db").Db
vi.mock("@/lib/db", () => ({ getDb: () => db }))
const { createTestDb } = await import("@poketrack/db/testing")
const { loginAction } = await import("./actions")
const { SESSION_COOKIE, verifySession } = await import("@/lib/session")

const form = (passcode: string, next?: string) => {
  const f = new FormData()
  f.set("passcode", passcode)
  if (next !== undefined) f.set("next", next)
  return f
}

beforeEach(async () => {
  db = await createTestDb()
  process.env.APP_PASSCODE = "pikachu-58"
  process.env.SESSION_SECRET = "s".repeat(40)
  set.mockClear()
  redirect.mockClear()
})
afterEach(() => {
  delete process.env.APP_PASSCODE
  delete process.env.SESSION_SECRET
})

test("a wrong passcode returns a message and sets no cookie", async () => {
  expect(await loginAction(undefined, form("nope"))).toEqual({ error: "That passcode isn't right." })
  expect(set).not.toHaveBeenCalled()
})

test("the right passcode sets a 90-day httpOnly cookie and redirects to next", async () => {
  await expect(loginAction(undefined, form("pikachu-58", "/scans/4"))).rejects.toMatchObject({ to: "/scans/4" })
  const [name, value, options] = set.mock.calls[0]!
  expect(name).toBe(SESSION_COOKIE)
  expect(await verifySession(value, Date.now(), { passcode: "pikachu-58", secret: "s".repeat(40) })).toBe(true)
  expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 90 * 24 * 60 * 60 })
})

test("next must be a local path", async () => {
  await expect(loginAction(undefined, form("pikachu-58", "https://evil.test/"))).rejects.toMatchObject({ to: "/" })
  await expect(loginAction(undefined, form("pikachu-58", "//evil.test/"))).rejects.toMatchObject({ to: "/" })
})

test("an unset passcode never logs in", async () => {
  delete process.env.APP_PASSCODE
  expect(await loginAction(undefined, form(""))).toEqual({ error: "That passcode isn't right." })
})

test("after 10 wrong guesses in 15 minutes even the right passcode is refused", async () => {
  for (let i = 0; i < 10; i++) await loginAction(undefined, form(`wrong-${i}`))
  expect(await loginAction(undefined, form("pikachu-58"))).toEqual({ error: "Too many tries. Wait 15 minutes and try again." })
  expect(set).not.toHaveBeenCalled()
})

test("old wrong guesses don't count, and a successful sign-in clears the count", async () => {
  const { sql } = await import("@poketrack/db")
  for (let i = 0; i < 9; i++) await loginAction(undefined, form(`wrong-${i}`))
  await expect(loginAction(undefined, form("pikachu-58"))).rejects.toMatchObject({ to: "/" })
  for (let i = 0; i < 9; i++) await loginAction(undefined, form(`wrong-${i}`))
  await expect(loginAction(undefined, form("pikachu-58"))).rejects.toMatchObject({ to: "/" })
  for (let i = 0; i < 9; i++) await loginAction(undefined, form(`wrong-${i}`))
  await db.execute(sql`update login_failures set at = now() - interval '20 minutes'`)
  for (let i = 0; i < 9; i++) await loginAction(undefined, form(`wrong-${i}`))
  await expect(loginAction(undefined, form("pikachu-58"))).rejects.toMatchObject({ to: "/" })
})
