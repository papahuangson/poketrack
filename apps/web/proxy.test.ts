import { NextRequest } from "next/server"
import { afterEach, beforeEach, expect, test } from "vitest"
import { config, proxy } from "./proxy"
import { SESSION_COOKIE, signSession } from "./lib/session"

const env = { passcode: "pikachu-58", secret: "s".repeat(40) }

beforeEach(() => {
  process.env.APP_PASSCODE = env.passcode
  process.env.SESSION_SECRET = env.secret
})
afterEach(() => {
  delete process.env.APP_PASSCODE
  delete process.env.SESSION_SECRET
})

const request = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "https://poketrack.test"), cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : undefined)

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1"

test("/ without a cookie redirects to /login?next=/", async () => {
  const res = await proxy(request("/"))
  expect(res.status).toBe(307)
  expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/login?next=%2F")
})

test("the next param keeps the path and query", async () => {
  const res = await proxy(request("/scans/4?x=1"))
  expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/scans/4?x=1")
})

test("/login passes", async () => {
  expect(passes(await proxy(request("/login")))).toBe(true)
})

test("/api/cron/nightly passes", async () => {
  expect(passes(await proxy(request("/api/cron/nightly")))).toBe(true)
})

test("/ with a valid cookie passes", async () => {
  expect(passes(await proxy(request("/", await signSession(Date.now(), env))))).toBe(true)
})

test("/api/scans without a cookie returns 401 instead of redirecting", async () => {
  const res = await proxy(request("/api/scans"))
  expect(res.status).toBe(401)
})

test("an unset passcode locks everything except the exempt routes", async () => {
  delete process.env.APP_PASSCODE
  expect((await proxy(request("/", await signSession(Date.now(), env)))).status).toBe(307)
  expect(passes(await proxy(request("/api/cron/nightly")))).toBe(true)
})

test("the matcher skips static assets", () => {
  expect(JSON.stringify(config.matcher)).toContain("_next/static")
})
