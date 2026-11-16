import { expect, test } from "vitest"
import { signSession, verifySession } from "./session"

const env = { passcode: "pikachu-58", secret: "s".repeat(40) }
const now = Date.UTC(2026, 10, 15)
const DAY = 24 * 60 * 60 * 1000

test("signed tokens verify", async () => {
  expect(await verifySession(await signSession(now, env), now + DAY, env)).toBe(true)
})

test("tokens expire after 90 days", async () => {
  const token = await signSession(now, env)
  expect(await verifySession(token, now + 90 * DAY - 1, env)).toBe(true)
  expect(await verifySession(token, now + 90 * DAY + 1, env)).toBe(false)
})

test("a tampered token fails", async () => {
  const token = await signSession(now, env)
  const [exp, sig] = token.split(".")
  expect(await verifySession(`${Number(exp) + 1000}.${sig}`, now, env)).toBe(false)
  expect(await verifySession(`${exp}.${sig}x`, now, env)).toBe(false)
  expect(await verifySession("garbage", now, env)).toBe(false)
  expect(await verifySession(undefined, now, env)).toBe(false)
})

test("a token signed under an old passcode fails after the passcode changes", async () => {
  const token = await signSession(now, env)
  expect(await verifySession(token, now, { ...env, passcode: "new-passcode" })).toBe(false)
})

test("a token signed with a different secret fails", async () => {
  const token = await signSession(now, env)
  expect(await verifySession(token, now, { ...env, secret: "t".repeat(40) })).toBe(false)
})
