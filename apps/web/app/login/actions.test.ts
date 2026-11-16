import { afterEach, beforeEach, expect, test, vi } from "vitest"

const set = vi.fn()
const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { to })
})
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }))

const { loginAction } = await import("./actions")
const { SESSION_COOKIE, verifySession } = await import("@/lib/session")

const form = (passcode: string, next?: string) => {
  const f = new FormData()
  f.set("passcode", passcode)
  if (next !== undefined) f.set("next", next)
  return f
}

beforeEach(() => {
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
